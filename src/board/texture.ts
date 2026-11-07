import type { Box, Look, ParsedLayer } from '../types'
import { FINISHES } from './palette'

const PX_PER_MM = 40
// ~0.15mm silk about 4px wide on 140mm board
const MAX_TEX = 4096

export function texturePx(box: Box, maxTex: number): { w: number; h: number } {
  const w = box.maxX - box.minX
  const h = box.maxY - box.minY
  const k = Math.min(PX_PER_MM, Math.min(maxTex, MAX_TEX) / Math.max(w, h))
  return { w: Math.round(w * k), h: Math.round(h * k) }
}

// surface mode draws roughness (G) / metalness (B), plus paste in R; exposed finish is metal
const surfaceColor = (roughness: number, metal: boolean) =>
  `rgb(0,${Math.round(roughness * 255)},${metal ? 255 : 0})`

// screen blending adds each layer into its own channel without touching the others
const channel = (body: string) => `<g style="mix-blend-mode:screen">${body}</g>`

// coverage mode (default): R copper, G mask opening, B silk; colors are applied later by the board shader
export function composeSideSvg(layers: ParsedLayer[], side: 'top' | 'bottom', look: Look, box: Box, px: { w: number; h: number }, surface = false): string {
  const W = box.maxX - box.minX
  const H = box.maxY - box.minY
  const pick = (type: ParsedLayer['id']['type']) =>
    layers.filter(l => l.id.side === side && l.id.type === type && look.enabled[l.file] !== false)
  const draw = (ls: ParsedLayer[], color: string) => ls.map(l => `<g color="${color}">${l.svgBody}</g>`).join('')
  const rect = (fill: string, extra = '') =>
    `<rect x="${box.minX}" y="${box.minY}" width="${W}" height="${H}" fill="${fill}"${extra}/>`

  const copper = pick('copper')
  const masks = pick('soldermask')
  let out = ''
  if (surface) {
    const finish = FINISHES.find(f => f.id === look.finish) ?? FINISHES[0]
    const dielectric = surfaceColor(look.matte ? 0.9 : 0.35, false)
    const metal = surfaceColor(finish.roughness, true)
    out += rect(dielectric)
    if (masks.length) {
      const id = `open-${side}`
      out += `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${box.minX}" y="${box.minY}" width="${W}" height="${H}">${rect('#000')}${draw(masks, '#fff')}</mask></defs>`
      out += `<g mask="url(#${id})">${draw(copper, metal)}</g>`
    } else out += draw(copper, metal)
    out += draw(pick('silkscreen'), dielectric)
    const paste = pick('solderpaste')
    if (paste.length) {
      const id = `paste-${side}`
      out += `<defs><pattern id="${id}-hatch" patternUnits="userSpaceOnUse" width="0.3" height="0.3" patternTransform="rotate(45)"><rect width="0.1" height="0.3" fill="#f00"/></pattern>`
      out += `<mask id="${id}" maskUnits="userSpaceOnUse" x="${box.minX}" y="${box.minY}" width="${W}" height="${H}">${rect('#000')}${draw(paste, '#fff')}</mask></defs>`
      out += channel(rect(`url(#${id}-hatch)`, ` mask="url(#${id})"`))
    }
  } else {
    out += rect('#000')
    out += channel(draw(copper, '#f00'))
    out += channel(masks.length ? draw(masks, '#0f0') : rect('#0f0'))
    out += channel(draw(pick('silkscreen'), '#00f'))
  }

  const f = (n: number) => n.toFixed(3)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px.w}" height="${px.h}" viewBox="0 0 ${W} ${H}"><g transform="translate(${f(-box.minX)} ${f(box.maxY)}) scale(1 -1)">${out}</g></svg>`
}

// flipped here because ImageBitmap uploads ignore WebGL's UNPACK_FLIP_Y.
export async function rasterize(svg: string, w: number, h: number, viaCanvas = false): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image(w, h)
    img.src = url
    await img.decode()
    if (!viaCanvas) return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, imageOrientation: 'flipY' })
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return await createImageBitmap(canvas, { imageOrientation: 'flipY' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
