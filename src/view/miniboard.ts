import * as THREE from 'three'
import { MASKS, SUBSTRATE } from '../board/palette'

export const MINI_SIZE = 120
export const MINI_MARGIN = 10

export type MiniPick = 'front' | 'back' | 'home'

export interface MiniBoard {
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, width: number, height: number): void
  // x, y in CSS pixels relative to the viewer container; null when outside the mini board
  pick(x: number, y: number, width: number): MiniPick | null
  setColor(color: string): void
  dispose(): void
}

// BoxGeometry face order: +x, -x, +y, -y, +z, -z; the board lies in XZ with its front facing +y
const FRONT_FACE = 2
const BACK_FACE = 3

function faceTexture(text: string): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 176
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  canvas.dataset.text = text
  return { canvas, tex }
}

// BoxGeometry's -y face maps the image to +x/+z; seen from below that is rotated 180 degrees, so back text is drawn rotated
function paintFace(canvas: HTMLCanvasElement, color: string, rotate = false): void {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
  ctx.fillStyle = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#151515' : '#f4f4f4'
  ctx.font = 'bold 54px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (rotate) ctx.setTransform(-1, 0, 0, -1, w, h)
  ctx.fillText(canvas.dataset.text!, w / 2, h / 2)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

export function createMiniBoard(): MiniBoard {
  const scene = new THREE.Scene()
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  cam.position.set(0, 0, 5.2)
  const front = faceTexture('FRONT')
  const back = faceTexture('BACK')
  const edge = new THREE.MeshBasicMaterial({ color: SUBSTRATE })
  const mats = [edge, edge, new THREE.MeshBasicMaterial({ map: front.tex }), new THREE.MeshBasicMaterial({ map: back.tex }), edge, edge]
  const geo = new THREE.BoxGeometry(2.2, 0.14, 1.5)
  const mesh = new THREE.Mesh(geo, mats)
  scene.add(mesh)
  const raycaster = new THREE.Raycaster()

  const setColor = (color: string) => {
    paintFace(front.canvas, color)
    paintFace(back.canvas, color, true)
    front.tex.needsUpdate = true
    back.tex.needsUpdate = true
  }

  setColor(MASKS[0].color)

  return {
    render(renderer, camera, width, height) {
      mesh.quaternion.copy(camera.quaternion).invert()
      const x = width - MINI_SIZE - MINI_MARGIN
      const y = height - MINI_SIZE - MINI_MARGIN
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.setViewport(x, y, MINI_SIZE, MINI_SIZE)
      renderer.setScissor(x, y, MINI_SIZE, MINI_SIZE)
      renderer.setScissorTest(true)
      renderer.clearDepth()
      renderer.render(scene, cam)
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, width, height)
      renderer.autoClear = autoClear
    },
    pick(x, y, width) {
      const left = width - MINI_SIZE - MINI_MARGIN
      if (x < left || x > left + MINI_SIZE || y < MINI_MARGIN || y > MINI_MARGIN + MINI_SIZE) return null
      raycaster.setFromCamera(new THREE.Vector2(((x - left) / MINI_SIZE) * 2 - 1, -((y - MINI_MARGIN) / MINI_SIZE) * 2 + 1), cam)
      const hit = raycaster.intersectObject(mesh)[0]
      if (!hit) return null
      const face = hit.face!.materialIndex
      return face === FRONT_FACE ? 'front' : face === BACK_FACE ? 'back' : 'home'
    },
    setColor,
    dispose() {
      geo.dispose()
      mats.forEach(m => m.dispose())
      front.tex.dispose()
      back.tex.dispose()
    },
  }
}
