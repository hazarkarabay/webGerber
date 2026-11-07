import * as THREE from 'three'
import './style.css'
import { entriesToFiles, readInputs } from './load/files'
import { fixDrillScale } from './load/parse'
import { parseAll } from './load/parallel'
import { boardArea, buildBoardPolygon } from './board/outline'
import { buildBoardGroup } from './board/mesh'
import { defaultLook, maskColor } from './board/palette'
import { composeSideSvg, rasterize, texturePx } from './board/texture'
import { createBoardUniforms, setBoardColors, useBoardShader, type DetailUniforms } from './board/shader'
import { createViewer, type Viewer } from './view/scene'
import { download, exportImage, exportName } from './view/export'
import { showAssign, type Assigned } from './ui/assign'
import { galleryFiles, showGallery, type GalleryItem } from './ui/gallery'
import { identifyLayer } from './load/identify'
import { buildPanel, type Change } from './ui/panel'
import type { Box, Look, ParsedLayer, Pt } from './types'

const $ = (id: string) => document.getElementById(id)!
const input = $('file-input') as HTMLInputElement
const start = $('start')
const viewing = $('viewing')
const errorBox = $('errors')
const busyEl = $('busy')
const panelToggle = $('panel-toggle')

let viewer: Viewer | null = null
let layers: ParsedLayer[] = []
let look: Look = defaultLook()
let infoEl: HTMLElement
let board: { mesh: ReturnType<typeof buildBoardGroup>; box: Box; detail: Record<'top' | 'bottom', DetailUniforms>; coverageKey?: string; surfaceKey?: string } | null = null
const boardUniforms = createBoardUniforms()
let geometryDirty = false
let dirty = false
let busy = false
let loadErrors: string[] = []
let runErrors: string[] = []

function showErrors() {
  const all = [...loadErrors, ...runErrors]
  $('error-items').replaceChildren(...all.map(e => Object.assign(document.createElement('li'), { textContent: e })))
  errorBox.hidden = !all.length
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e)
// rAF fires before the next paint, the timeout after it, so the busy overlay is visible before sync work starts
const painted = () => new Promise(r => requestAnimationFrame(() => setTimeout(r)))

// a short name for what was opened: the folder or file, or the first one and how many more
const describe = (names: string[]) => names.length > 1 ? `${names[0]} and ${names.length - 1} more` : names[0] ?? ''

let exportBase = 'webgerber'

async function load(files: File[], names = files.map(f => f.name)) {
  const source = describe(names)
  if (!files.length) return
  const { files: read, skipped } = await readInputs(files)
  loadErrors = read.length ? [] : ['No readable files found.']
  runErrors = []
  showErrors()
  viewing.hidden = true
  panelToggle.hidden = true
  start.hidden = false
  exportBase = exportName(names)
  $('gallery-section').hidden = true
  showAssign($('assign'), read, skipped, source, view)
  viewer ??= createViewer($('view'))
  viewer.onViewSettled(updateDetail)
}

// curated sets are identified correctly, so they skip the assignment step
async function openGallery(item: GalleryItem) {
  busyEl.hidden = false
  try {
    const { files } = await readInputs(await galleryFiles(item))
    exportBase = exportName([item.slug])
    await view(files.flatMap(file => { const id = identifyLayer(file); return id ? [{ file, id }] : [] }))
  } catch (e) {
    busyEl.hidden = !busy
    loadErrors = [`Could not open ${item.name}: ${message(e)}`]
    showErrors()
  }
}

async function view(assigned: Assigned[]) {
  busyEl.hidden = false
  await painted()
  const { layers: parsed, errors } = await parseAll(assigned)
  if (!parsed.length) errors.push('No layer could be loaded.')
  loadErrors = errors
  runErrors = []
  showErrors()
  if (!parsed.length) {
    busyEl.hidden = !busy
    return
  }

  layers = fixDrillScale(parsed)
  look = { ...look, enabled: {} }
  start.hidden = true
  viewing.hidden = false
  panelToggle.hidden = false
  viewer ??= createViewer($('view'))
  viewer.onViewSettled(updateDetail)
  viewer.setBackground(look.background)
  infoEl = buildPanel($('panel'), layers, look, changed, exportAs)
  board = null
  geometryDirty = true
  refresh()
}

function changed(c: Change) {
  if (c === 'background') viewer!.setBackground(look.background)
  else if (c === 'color') {
    setBoardColors(boardUniforms, look)
    viewer!.setMaskColor(maskColor(look))
    viewer!.invalidate()
  } else {
    if (c === 'geometry') geometryDirty = true
    refresh()
  }
}

// export waits for a rebuild in progress; otherwise it can capture a scene whose board is not handed over yet
let idleWaiters: (() => void)[] = []
const whenIdle = () => busy ? new Promise<void>(r => idleWaiters.push(r)) : Promise.resolve()

async function exportAs(kind: 'jpg' | 'png') {
  try {
    await whenIdle()
    download(await exportImage(viewer!, kind), `${exportBase}.${kind}`)
  } catch (e) {
    runErrors.push(`Export failed: ${message(e)}`)
    showErrors()
  }
}

// Serialized so rapid changes never race: a request during a run triggers one more run with the latest state.
async function refresh() {
  dirty = true
  if (busy) return
  busy = true
  if (busyEl.hidden) {
    busyEl.hidden = false
    await painted()
  }
  while (dirty) {
    dirty = false
    try {
      await rebuild()
      runErrors = []
    } catch (e) {
      // a half-built board was never handed to the viewer; force the next run to rebuild it
      board = null
      runErrors.push(`Render failed: ${message(e)}`)
    }
    showErrors()
  }
  busy = false
  busyEl.hidden = true
  idleWaiters.splice(0).forEach(r => r())
}

// the bitmap is already flipped; close it once three has uploaded it
function bitmapTexture(bitmap: ImageBitmap): THREE.Texture {
  const tex = new THREE.Texture(bitmap)
  tex.flipY = false
  tex.needsUpdate = true
  tex.onUpdate = () => bitmap.close()
  return tex
}

// zoomed in past the base texture resolution, the visible region gets its own coverage image at screen resolution
let detailToken = 0
function clearDetail(b: NonNullable<typeof board>) {
  for (const d of Object.values(b.detail)) { d.uDetail.value?.dispose(); d.uDetail.value = null; d.uDetailRect.value.set(0, 0, 0, 0) }
}

async function updateDetail() {
  const b = board
  const view = viewer?.visibleRegion()
  const token = ++detailToken
  if (!b || !view) return
  const W = b.box.maxX - b.box.minX, H = b.box.maxY - b.box.minY
  const basePxPerMm = texturePx(b.box, viewer!.renderer.capabilities.maxTextureSize).w / W
  if (view.pxPerMm <= basePxPerMm * 1.2) { clearDetail(b); viewer!.invalidate(); return }
  const r = view.region, pad = 0.1 * Math.max(r.maxX - r.minX, r.maxY - r.minY)
  const region = { minX: Math.max(b.box.minX, r.minX - pad), minY: Math.max(b.box.minY, r.minY - pad), maxX: Math.min(b.box.maxX, r.maxX + pad), maxY: Math.min(b.box.maxY, r.maxY + pad) }
  const rw = region.maxX - region.minX, rh = region.maxY - region.minY
  const k = Math.min(view.pxPerMm * 1.25, 4096 / Math.max(rw, rh))
  const w = Math.max(1, Math.round(rw * k)), h = Math.max(1, Math.round(rh * k))
  const bitmap = await rasterize(composeSideSvg(layers, view.side, structuredClone(look), region, { w, h }), w, h, true)
  if (token !== detailToken || board !== b) { bitmap.close(); return }
  clearDetail(b)
  const tex = bitmapTexture(bitmap)
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  const d = b.detail[view.side]
  d.uDetail.value = tex
  d.uDetailRect.value.set((region.minX - b.box.minX) / W, (region.minY - b.box.minY) / H, rw / W, rh / H)
  viewer!.invalidate()
}

function showInfo(polygon: Pt[][][], box: Box) {
  const count = (type: string, side?: string) =>
    layers.filter(l => l.id.type === type && (!side || l.id.side === side)).reduce((n, l) => n + l.flashes, 0)
  const holes = layers.filter(l => l.id.type === 'drill').flatMap(l => l.holes)
  const slots = layers.filter(l => l.id.type === 'drill').flatMap(l => l.strokes).filter(s => s.width > 0).length
  const rows: [string, string, string?][] = polygon.length
    ? [
        ['Size', `${(box.maxX - box.minX).toFixed(1)} x ${(box.maxY - box.minY).toFixed(1)} mm`, 'board-size'],
        ['Area', `${Math.round(boardArea(polygon))} mm`, 'board-area'],
        ['Pads (top)', String(count('copper', 'top'))],
        ['Pads (bottom)', String(count('copper', 'bottom'))],
        ['Drill holes', String(holes.length)],
        ['Hole sizes', String(new Set(holes.map(h => h.d.toFixed(2))).size)],
        ['Slots', String(slots)],
      ]
    : [['Size', 'No board outline found', 'board-size']]
  infoEl.replaceChildren(...rows.flatMap(([k, v, testid]) => {
    const dd = document.createElement('dd')
    dd.textContent = v
    if (k === 'Area') dd.append(Object.assign(document.createElement('sup'), { textContent: '2' }))
    if (testid) dd.dataset.testid = testid
    return [Object.assign(document.createElement('dt'), { textContent: k }), dd]
  }))
}

async function rebuild() {
  let fresh = false
  const kept = board !== null
  if (geometryDirty || !board) {
    geometryDirty = false
    const { polygon, box } = buildBoardPolygon(
      layers.filter(l => !['outline', 'milling', 'drill'].includes(l.id.type) || look.enabled[l.file] !== false))
    showInfo(polygon, box)
    if (!polygon.length) {
      board = null
      viewer!.setBoard(new THREE.Group(), box)
      return
    }
    if (board) clearDetail(board)
    const mesh = buildBoardGroup(polygon, box)
    const shade = (m: THREE.Mesh) => useBoardShader(m.material as THREE.MeshStandardMaterial, boardUniforms)
    board = { mesh, box, detail: { top: shade(mesh.top), bottom: shade(mesh.bottom) } }
    fresh = true
  }
  const b = board
  const r = viewer!.renderer
  const { w, h } = texturePx(b.box, r.capabilities.maxTextureSize)
  const snapshot = structuredClone(look)
  const sw = Math.round(w / 2), sh = Math.round(h / 2)
  const sides = ['top', 'bottom'] as const
  // colors live in shader uniforms; images are re-rasterized only when what they encode changes
  const coverageKey = JSON.stringify(snapshot.enabled)
  const surfaceKey = JSON.stringify([snapshot.matte, snapshot.finish, snapshot.enabled])
  const keepCoverage = b.coverageKey === coverageKey
  const keepSurface = b.surfaceKey === surfaceKey
  const single = keepCoverage !== keepSurface
  const [coverages, surfaces] = await Promise.all([
    keepCoverage ? null : Promise.all(sides.map(side => rasterize(composeSideSvg(layers, side, snapshot, b.box, { w, h }), w, h, single))),
    keepSurface ? null : Promise.all(sides.map(side => rasterize(composeSideSvg(layers, side, snapshot, b.box, { w: sw, h: sh }, true), sw, sh, single))),
  ])
  if (board !== b) return
  sides.forEach((_, i) => {
    const mat = (i ? b.mesh.bottom : b.mesh.top).material as THREE.MeshStandardMaterial
    if (coverages) {
      const tex = bitmapTexture(coverages[i])
      tex.anisotropy = r.capabilities.getMaxAnisotropy()
      mat.map?.dispose()
      mat.map = tex
    }
    if (surfaces) {
      mat.roughnessMap?.dispose()
      mat.roughnessMap = mat.metalnessMap = bitmapTexture(surfaces[i])
    }
    mat.metalness = 1
    mat.roughness = 1
    mat.needsUpdate = true
  })
  if (coverages) { clearDetail(b); updateDetail() }
  b.coverageKey = coverageKey
  b.surfaceKey = surfaceKey
  setBoardColors(boardUniforms, snapshot)
  viewer!.setMaskColor(maskColor(snapshot))
  viewer!.invalidate()
  if (fresh) viewer!.setBoard(b.mesh.group, b.box, !kept)
}

input.addEventListener('change', () => {
  load([...(input.files ?? [])])
  input.value = ''
})
$('open-btn').addEventListener('click', () => input.click())
$('errors-dismiss').addEventListener('click', () => {
  loadErrors = []
  runErrors = []
  showErrors()
})
panelToggle.addEventListener('click', () => {
  const panel = $('panel')
  panel.hidden = !panel.hidden
  panelToggle.setAttribute('aria-expanded', String(!panel.hidden))
  panelToggle.textContent = panel.hidden ? 'Show settings' : 'Hide settings'
})
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => {
  e.preventDefault()
  // read the DataTransfer synchronously; it is emptied once the handler returns
  const files = [...(e.dataTransfer?.files ?? [])]
  const entries = [...(e.dataTransfer?.items ?? [])].map(i => i.webkitGetAsEntry()).filter(x => x !== null)
  if (entries.length) entriesToFiles(entries).then(fs => load(fs, entries.map(e => e.name)), () => load(files))
  else load(files)
})
showGallery($('gallery'), openGallery)
