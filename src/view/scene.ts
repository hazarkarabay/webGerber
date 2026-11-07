import * as THREE from 'three'
import { TrackballControls } from 'three/addons/controls/TrackballControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { paintBackground } from '../board/palette'
import type { Box } from '../types'
import { createMiniBoard, MINI_MARGIN, MINI_SIZE } from './miniboard'
import { createBoardUniforms, useBoardShader } from '../board/shader'

export interface Viewer {
  setBoard(group: THREE.Group, box: Box, resetView?: boolean): void
  setBackground(id: string): void
  setMaskColor(color: string): void
  home(): void
  // scale renders at a multiple of the screen pixel density; the next call with scale 1 restores it
  renderFrame(transparent: boolean, scale?: number): void
  invalidate(): void
  // called once the camera has been still for a moment after moving
  onViewSettled(cb: () => void): void
  // board-local region (mm) visible on screen, the side facing the camera and screen device pixels per mm at the center
  visibleRegion(): { side: 'top' | 'bottom'; region: Box; pxPerMm: number } | null
  renderer: THREE.WebGLRenderer
  dispose(): void
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.dispose()
    for (const mat of [m.material].flat() as THREE.MeshStandardMaterial[]) {
      mat.map?.dispose()
      mat.roughnessMap?.dispose()
      mat.dispose()
    }
  })
}

export function createViewer(container: HTMLElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setClearAlpha(0)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  // reflections for the metallic pad finish; without them metal renders nearly black
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.35
  pmrem.dispose()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000)
  const controls = new TrackballControls(camera, renderer.domElement)
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
  controls.rotateSpeed = 3
  controls.minDistance = 5

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.4))
  const sun = new THREE.DirectionalLight(0xffffff, 2)
  sun.position.set(60, 120, 80)
  scene.add(sun)
  const under = new THREE.DirectionalLight(0xffffff, 2)
  under.position.set(-60, -120, -80)
  scene.add(under)

  const mini = createMiniBoard()

  // up is the screen-up direction; looking straight down or up it cannot be the world Y axis
  const VIEWS = {
    home: { dir: new THREE.Vector3(0.317, 0.887, 0.337), up: new THREE.Vector3(0.027, 0.347, -0.938), label: 'Home', aria: 'Reset view', testid: 'home-btn' },
    front: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1), label: 'Front', aria: 'View front side', testid: 'view-front' },
    back: { dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, -1), label: 'Back', aria: 'View back side', testid: 'view-back' },
  }
  type ViewName = keyof typeof VIEWS
  const viewBtns = (Object.keys(VIEWS) as ViewName[]).map((name, i) => {
    const v = VIEWS[name]
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.testid = v.testid
    btn.setAttribute('aria-label', v.aria)
    btn.textContent = v.label
    btn.style.cssText = `position:absolute;top:${MINI_MARGIN + MINI_SIZE + 10 + i * 30}px;right:${MINI_MARGIN + (MINI_SIZE - 56) / 2}px;width:56px;z-index:10;cursor:pointer`
    container.appendChild(btn)
    return { btn, onClick: () => goTo(name, true) }
  })

  const bg = document.createElement('canvas')
  const bgTex = new THREE.CanvasTexture(bg)
  bgTex.colorSpace = THREE.SRGBColorSpace
  scene.background = bgTex
  let background = 'studio'
  let board: THREE.Group | null = null
  let box: Box | null = null

  // render only when something changed
  let needsRender = true
  const invalidate = () => { needsRender = true }
  const POINTER_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'wheel'] as const
  POINTER_EVENTS.forEach(t => container.addEventListener(t, invalidate))
  controls.addEventListener('change', invalidate)

  let downAt: { x: number; y: number } | null = null
  const local = (e: MouseEvent) => { const r = container.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const onDown = (e: PointerEvent) => { downAt = local(e) }
  const onClick = (e: MouseEvent) => {
    const p = local(e)
    const pick = downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) < 4 ? mini.pick(p.x, p.y, container.clientWidth) : null
    downAt = null
    if (pick) goTo(pick, true)
  }
  const onHover = (e: PointerEvent) => { const p = local(e); container.style.cursor = mini.pick(p.x, p.y, container.clientWidth) ? 'pointer' : '' }
  container.addEventListener('pointerdown', onDown)
  container.addEventListener('click', onClick)
  container.addEventListener('pointermove', onHover)

  const paint = () => {
    const ctx = bg.getContext('2d')!
    paintBackground(ctx, bg.width, bg.height, background)
    bgTex.needsUpdate = true
    invalidate()
  }

  const HOME_MS = 500
  let tween: { t0: number; q0: THREE.Quaternion; q1: THREE.Quaternion; d0: number; d1: number; c0: THREE.Vector3; up: THREE.Vector3 } | null = null

  // clears TrackballControls' internal momentum fields (hack)
  const stopMomentum = () => {
    const c = controls as unknown as Record<'_movePrev' | '_moveCurr' | '_zoomStart' | '_zoomEnd' | '_panStart' | '_panEnd', THREE.Vector2> & { _lastAngle: number; _lastRollAngle: number }
    c._lastAngle = 0
    c._lastRollAngle = 0
    c._movePrev.copy(c._moveCurr)
    c._zoomStart.copy(c._zoomEnd)
    c._panStart.copy(c._panEnd)
  }

  const goTo = (name: ViewName, animate = false) => {
    const view = VIEWS[name]
    const w = box ? box.maxX - box.minX : 100
    const h = box ? box.maxY - box.minY : 80
    const r = Math.hypot(w, h, 1.6) / 2
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1
    camera.near = dist / 100
    camera.far = dist * 20
    camera.updateProjectionMatrix()
    const end = view.dir.clone().normalize().multiplyScalar(dist)
    const q1 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(end, new THREE.Vector3(), view.up))
    if (animate) {
      tween = { t0: performance.now(), q0: camera.quaternion.clone(), q1, d0: camera.position.distanceTo(controls.target), d1: dist, c0: controls.target.clone(), up: view.up }
      controls.enabled = false
      stopMomentum()
      return
    }
    tween = null
    controls.target.set(0, 0, 0)
    camera.up.copy(view.up)
    camera.position.copy(end)
    camera.quaternion.copy(q1)
    controls.update()
  }

  const stepTween = () => {
    if (!tween) return
    const k = Math.min(1, (performance.now() - tween.t0) / HOME_MS)
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
    camera.quaternion.slerpQuaternions(tween.q0, tween.q1, e)
    controls.target.lerpVectors(tween.c0, new THREE.Vector3(), e)
    camera.position.set(0, 0, 1).applyQuaternion(camera.quaternion)
      .multiplyScalar(THREE.MathUtils.lerp(tween.d0, tween.d1, e)).add(controls.target)
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    if (k === 1) {
      camera.up.copy(tween.up)
      tween = null
      stopMomentum()
      controls.enabled = true
    }
  }

  const resize = () => {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    bg.width = w
    bg.height = h
    // three allocates textures with a fixed size; a resized canvas needs a fresh GPU texture
    bgTex.dispose()
    paint()
    controls.handleResize()
  }

  const ro = new ResizeObserver(resize)
  ro.observe(container)
  const home = () => goTo('home')
  // console helper
  if (import.meta.env.DEV) (window as unknown as { wgView: () => string }).wgView = () => {
    const f = (v: THREE.Vector3) => `new THREE.Vector3(${v.toArray().map(n => +n.toFixed(3)).join(', ')})`
    return `dir: ${f(camera.position.clone().sub(controls.target).normalize())}, up: ${f(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion))}`
  }
  viewBtns.forEach(v => v.btn.addEventListener('click', v.onClick))
  resize()
  home()

  renderer.capabilities.getMaxAnisotropy()
  const warmMap = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  const warmBoard = new THREE.MeshStandardMaterial({ map: warmMap, roughnessMap: warmMap, metalnessMap: warmMap })
  useBoardShader(warmBoard, createBoardUniforms())
  const warm = new THREE.Group().add(
    new THREE.Mesh(new THREE.PlaneGeometry(), warmBoard),
    new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial()),
  )
  renderer.compileAsync(warm, camera, scene).catch(() => {})

  let settled: (() => void) | null = null
  let settleTimer = 0
  const lastPose = new THREE.Matrix4()
  const scheduleSettle = () => { clearTimeout(settleTimer); settleTimer = window.setTimeout(() => settled?.(), 250) }

  renderer.setAnimationLoop(() => {
    if (tween) { stepTween(); invalidate() }
    else controls.update()
    if (!needsRender) return
    needsRender = false
    // clip planes follow the zoom; fixed ones clip the board away when zooming in close
    const d = camera.position.distanceTo(controls.target)
    if (Math.abs(camera.near - d / 100) > d / 1000) { camera.near = d / 100; camera.far = d * 20 + 1000; camera.updateProjectionMatrix() }
    camera.updateMatrixWorld()
    if (!camera.matrixWorld.equals(lastPose)) { lastPose.copy(camera.matrixWorld); scheduleSettle() }
    renderer.render(scene, camera)
    mini.render(renderer, camera, container.clientWidth, container.clientHeight)
  })

  return {
    renderer,
    setBoard(group, b, resetView = true) {
      if (board) { scene.remove(board); disposeGroup(board) }
      board = group
      box = b
      scene.add(group)
      if (resetView) home()
      invalidate()
      scheduleSettle()
    },
    setBackground(id) { background = id; paint() },
    setMaskColor(color) { mini.setColor(color); invalidate() },
    home,
    renderFrame(transparent, scale = 1) {
      scene.background = transparent ? null : bgTex
      if (renderer.getPixelRatio() !== window.devicePixelRatio * scale) renderer.setPixelRatio(window.devicePixelRatio * scale)
      renderer.render(scene, camera)
      invalidate()
    },
    invalidate,
    onViewSettled(cb) { settled = cb },
    visibleRegion() {
      if (!board || !box) return null
      board.updateMatrixWorld()
      const inv = board.matrixWorld.clone().invert()
      const side = camera.position.clone().applyMatrix4(inv).z > 0.8 ? 'top' : 'bottom'
      const z = side === 'top' ? 1.6 : 0
      const ray = new THREE.Raycaster()
      const hit = (x: number, y: number) => {
        ray.setFromCamera(new THREE.Vector2(x, y), camera)
        const o = ray.ray.origin.clone().applyMatrix4(inv), d = ray.ray.direction.clone().transformDirection(inv)
        const t = (z - o.z) / d.z
        return t > 0 && Number.isFinite(t) ? o.addScaledVector(d, t) : null
      }
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const p = hit(i / 2 - 1, j / 2 - 1); if (p) pts.push(p) }
      const region = {
        minX: Math.max(box.minX, Math.min(...pts.map(p => p.x))), maxX: Math.min(box.maxX, Math.max(...pts.map(p => p.x))),
        minY: Math.max(box.minY, Math.min(...pts.map(p => p.y))), maxY: Math.min(box.maxY, Math.max(...pts.map(p => p.y))),
      }
      const c = hit(0, 0)
      if (!c || region.maxX <= region.minX || region.maxY <= region.minY) return null
      const toScreen = (p: THREE.Vector3) => {
        const s = p.clone().applyMatrix4(board!.matrixWorld).project(camera)
        return new THREE.Vector2(s.x * renderer.domElement.width / 2, s.y * renderer.domElement.height / 2)
      }
      const s0 = toScreen(c)
      const pxPerMm = Math.max(toScreen(c.clone().setX(c.x + 1)).distanceTo(s0), toScreen(c.clone().setY(c.y + 1)).distanceTo(s0))
      return { side, region, pxPerMm }
    },
    dispose() {
      clearTimeout(settleTimer)
      renderer.setAnimationLoop(null)
      POINTER_EVENTS.forEach(t => container.removeEventListener(t, invalidate))
      ro.disconnect()
      viewBtns.forEach(v => { v.btn.removeEventListener('click', v.onClick); v.btn.remove() })
      container.removeEventListener('pointerdown', onDown)
      container.removeEventListener('click', onClick)
      container.removeEventListener('pointermove', onHover)
      mini.dispose()
      controls.dispose()
      if (board) disposeGroup(board)
      bgTex.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
