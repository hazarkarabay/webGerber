import type { Look } from '../types'

// needs fixing
export const MASKS = [
  { id: 'green', label: 'Green', color: '#005228', matte: false },
  { id: 'matte-green', label: 'Matte green', color: '#2f6b45', matte: true },
  { id: 'red', label: 'Red', color: '#a90800', matte: false },
  { id: 'yellow', label: 'Yellow', color: '#b46d00', matte: false },
  { id: 'blue', label: 'Blue', color: '#001a4b', matte: false },
  { id: 'purple', label: 'Purple', color: '#35105b', matte: false },
  { id: 'white', label: 'White', color: '#9fa2a6', matte: false },
  { id: 'black', label: 'Black', color: '#0d0d0e', matte: false },
  { id: 'matte-black', label: 'Matte black', color: '#151516', matte: true },
]

export const SILKS = [
  { id: 'white', label: 'White', color: '#f4f4f4' },
  { id: 'black', label: 'Black', color: '#111111' },
  { id: 'yellow', label: 'Yellow', color: '#e8d33a' },
]

export const FINISHES = [
  { id: 'hasl', label: 'HASL', color: '#c9c9c9', roughness: 0.15 },
  { id: 'enig', label: 'ENIG', color: '#d4b45a', roughness: 0.45 },
]

export const SUBSTRATE = '#c2b280'

export const maskColor = (look: Look): string =>
  MASKS.find(m => m.id === look.mask)?.color ?? (/^#[0-9a-f]{6}$/i.test(look.mask) ? look.mask : MASKS[0].color)
export const PASTE = '#b8b8b8'

type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => void
const flat = (c: string): Paint => (ctx, w, h) => { ctx.fillStyle = c; ctx.fillRect(0, 0, w, h) }

export const BACKGROUNDS: { id: string; label: string; paint: Paint }[] = [
  {
    id: 'studio', label: 'Studio',
    paint: (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
      g.addColorStop(0, '#3a3f47')
      g.addColorStop(1, '#1c1f24')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    },
  },
  { id: 'white', label: 'White', paint: flat('#ffffff') },
  { id: 'dark', label: 'Dark', paint: flat('#2b2b2b') },
  {
    id: 'mat', label: 'ESD mat',
    paint: (ctx, w, h) => {
      flat('#3d6f8a')(ctx, w, h)
      ctx.fillStyle = '#335d74'
      for (let x = 0; x < w; x += 24) ctx.fillRect(x, 0, 1, h)
      for (let y = 0; y < h; y += 24) ctx.fillRect(0, y, w, 1)
    },
  },
]

export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, background: string): void {
  const preset = BACKGROUNDS.find(b => b.id === background)
  if (preset) preset.paint(ctx, w, h)
  else flat(background)(ctx, w, h)
}

export const defaultLook = (): Look =>
  ({ mask: 'green', matte: false, silk: 'white', finish: 'hasl', copperVisibility: 1, background: 'studio', enabled: {} })
