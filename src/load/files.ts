import JSZip from 'jszip'
import type { LayerFile } from '../types'

const SKIP_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'zip', 'gbrjob', 'kicad_pcb', 'brd', 'sch'])

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const ext = (n: string) => n.slice(n.lastIndexOf('.') + 1).toLowerCase()
const skippable = (n: string) => n.startsWith('.') || SKIP_EXT.has(ext(n))

const decode = (bytes: Uint8Array): string | null =>
  bytes.subarray(0, 1024).includes(0) ? null : new TextDecoder().decode(bytes)

const isZip = (name: string, b: Uint8Array) =>
  ext(name) === 'zip' || (b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4)

export async function entriesToFiles(entries: FileSystemEntry[]): Promise<File[]> {
  const out: File[] = []
  for (const e of entries) {
    if (e.isFile) out.push(await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail)))
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader()
      for (let batch: FileSystemEntry[]; (batch = await new Promise((ok, fail) => reader.readEntries(ok, fail))).length;)
        out.push(...await entriesToFiles(batch))
    }
  }
  return out
}

export async function readInputs(files: File[]): Promise<{ files: LayerFile[]; skipped: string[] }> {
  const out: LayerFile[] = []
  const skipped: string[] = []
  const add = (name: string, bytes: Uint8Array) => {
    const text = decode(bytes)
    if (text === null) skipped.push(name)
    else out.push({ name, text })
  }
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (isZip(f.name, bytes)) {
        const zip = await JSZip.loadAsync(bytes)
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue
          const name = baseName(entry.name)
          if (entry.name.startsWith('__MACOSX/') || skippable(name)) skipped.push(entry.name.startsWith('__MACOSX/') ? entry.name : name)
          else add(name, await entry.async('uint8array'))
        }
      } else if (skippable(f.name)) skipped.push(f.name)
      else add(f.name, bytes)
    } catch {
      skipped.push(f.name)
    }
  }
  return { files: out, skipped }
}
