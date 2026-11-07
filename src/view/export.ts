import type { Viewer } from './scene'

// crops a canvas to the bounding box of its non-transparent pixels
function trimmed(src: HTMLCanvasElement): HTMLCanvasElement {
  const { width: w, height: h } = src
  const copy = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = copy.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)
  const a = ctx.getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!a[(y * w + x) * 4 + 3]) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < 0) return copy
  const out = Object.assign(document.createElement('canvas'), { width: maxX - minX + 1, height: maxY - minY + 1 })
  out.getContext('2d')!.drawImage(copy, -minX, -minY)
  return out
}

export function exportImage(viewer: Viewer, kind: 'jpg' | 'png'): Promise<Blob> {
  const png = kind === 'png'
  return new Promise((resolve, reject) => {
    try {
      viewer.renderFrame(png, png ? 2 : 1)
      const canvas = png ? trimmed(viewer.renderer.domElement) : viewer.renderer.domElement
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Image export failed'))),
        png ? 'image/png' : 'image/jpeg',
        png ? undefined : 0.92,
      )
    } catch (e) {
      reject(e)
    } finally {
      if (png) viewer.renderFrame(false)
    }
  })
}

// webgerber-xxx: a folder or file name without extension or the shared start of several file names
export function exportName(names: string[]): string {
  const stems = names.map(n => n.replace(/\.[^.]*$/, ''))
  let base = stems[0] ?? ''
  for (const s of stems.slice(1)) while (!s.startsWith(base)) base = base.slice(0, -1)
  base = base.replace(/[-_. ]+$/, '') || stems[0] || ''
  base = base.replace(/[\\/:*?"<>|]+/g, '_')
  return base ? `webgerber-${base}` : 'webgerber'
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
