import { parse } from '@tracespace/parser'
import { plot, positionsEqual } from '@tracespace/plotter'
import type { ImageTree, PathSegment } from '@tracespace/plotter'
import { BASE_IMAGE_PROPS, renderFragment } from '@tracespace/renderer'
import type { SvgElement } from '@tracespace/renderer'
import type { Hole, LayerFile, LayerId, ParsedLayer, Pt, Stroke } from '../types'

const CHORD_ERROR_MM = 0.05
const CAMEL_ATTRS = new Set(['maskUnits', 'viewBox', 'clipPathUnits', 'patternUnits'])

export function parseLayer(file: LayerFile, id: LayerId): ParsedLayer {
  let image: ImageTree
  try {
    image = plot(parse(file.text))
  } catch (e) {
    throw new Error(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const k = image.units === 'in' ? 25.4 : 1
  const [minX = 0, minY = 0, maxX = 0, maxY = 0] = image.size.map(v => v * k)
  const strokes: Stroke[] = []
  const holes: Hole[] = []
  const vector = id.type === 'drill' || id.type === 'outline' || id.type === 'milling'

  for (const node of vector ? image.children.filter(n => !n.erase) : []) {
    if (node.type === 'imagePath') {
      let current: Stroke | undefined
      let prevEnd: number[] | undefined
      for (const seg of node.segments) {
        if (!current || !prevEnd || !positionsEqual(prevEnd, seg.start)) {
          current = { points: [[seg.start[0] * k, seg.start[1] * k]], width: node.width * k }
          strokes.push(current)
        }
        current.points.push(...segmentPoints(seg, k))
        prevEnd = seg.end
      }
    } else if (id.type === 'drill' && node.type === 'imageShape' && node.shape.type === 'circle') {
      holes.push({ x: node.shape.cx * k, y: node.shape.cy * k, d: 2 * node.shape.r * k })
    }
  }

  // the renderer emits y-down coordinates, so flip back to Gerber y-up
  const attrs = { ...BASE_IMAGE_PROPS, transform: `scale(${k},${-k})` }
  const svgBody = `<g ${Object.entries(attrs).map(([a, v]) => `${a}="${v}"`).join(' ')}>${toSvg(renderFragment(image))}</g>`
  const flashes = image.children.filter(n => n.type === 'imageShape' && !n.erase).length
  return { file: file.name, id, svgBody, bounds: { minX, minY, maxX, maxY }, strokes, holes, flashes }
}

function segmentPoints(seg: PathSegment, k: number): Pt[] {
  if (seg.type === 'line') return [[seg.end[0] * k, seg.end[1] * k]]
  const r = seg.radius * k
  const sweep = seg.end[2] - seg.start[2]
  const step = r > CHORD_ERROR_MM ? 2 * Math.acos(1 - CHORD_ERROR_MM / r) : Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / step))
  const pts: Pt[] = []
  for (let i = 1; i < n; i++) {
    const t = seg.start[2] + (sweep * i) / n
    pts.push([seg.center[0] * k + r * Math.cos(t), seg.center[1] * k + r * Math.sin(t)])
  }
  pts.push([seg.end[0] * k, seg.end[1] * k])
  return pts
}

function toSvg(el: SvgElement): string {
  const attrs = Object.entries(el.properties ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, v]) => ` ${CAMEL_ATTRS.has(key) ? key : key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${v}"`)
    .join('')
  const children = el.children.map(c => (c.type === 'element' ? toSvg(c) : '')).join('')
  return `<${el.tagName}${attrs}>${children}</${el.tagName}>`
}

const SCALES = [0.1, 0.01, 10, 100]

// handle misaligned drill (excellon 2.4)
export function fixDrillScale(layers: ParsedLayer[]): ParsedLayer[] {
  const ref = layers.filter(l => l.id.type !== 'drill' && l.bounds.maxX > l.bounds.minX).map(l => l.bounds)
  if (!ref.length) return layers
  const minX = Math.min(...ref.map(b => b.minX)) - 1, maxX = Math.max(...ref.map(b => b.maxX)) + 1
  const minY = Math.min(...ref.map(b => b.minY)) - 1, maxY = Math.max(...ref.map(b => b.maxY)) + 1
  const fits = (pts: Pt[], k: number) => pts.every(([x, y]) => x * k >= minX && x * k <= maxX && y * k >= minY && y * k <= maxY)
  return layers.map(l => {
    const pts: Pt[] = [...l.holes.map(h => [h.x, h.y] as Pt), ...l.strokes.flatMap(s => s.points)]
    if (l.id.type !== 'drill' || !pts.length || fits(pts, 1)) return l
    const k = SCALES.find(s => fits(pts, s))
    if (!k) return l
    const b = l.bounds
    return {
      ...l,
      svgBody: `<g transform="scale(${k})">${l.svgBody}</g>`,
      bounds: { minX: b.minX * k, minY: b.minY * k, maxX: b.maxX * k, maxY: b.maxY * k },
      holes: l.holes.map(h => ({ ...h, x: h.x * k, y: h.y * k })),
      strokes: l.strokes.map(s => ({ ...s, points: s.points.map(([x, y]) => [x * k, y * k] as Pt) })),
    }
  })
}
