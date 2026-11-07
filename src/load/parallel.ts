import { parseLayer } from './parse'
import type { LayerFile, LayerId, ParsedLayer } from '../types'

type Job = { file: LayerFile; id: LayerId }
type Reply = { ok: true; layer: ParsedLayer } | { ok: false; error: string }

function parseSync({ file, id }: Job): Reply {
  try {
    return { ok: true, layer: parseLayer(file, id) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : `${file.name}: ${String(e)}` }
  }
}

export async function parseAll(assigned: Job[]): Promise<{ layers: ParsedLayer[]; errors: string[] }> {
  const replies: Reply[] = new Array(assigned.length)
  const size = Math.min(4, navigator.hardwareConcurrency || 2, assigned.length)
  let next = 0

  const runWorker = () =>
    new Promise<void>(resolve => {
      let worker: Worker
      try {
        worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
      } catch {
        resolve()
        return
      }
      let current = -1
      const feed = () => {
        if (next >= assigned.length) {
          worker.terminate()
          resolve()
          return
        }
        current = next++
        worker.postMessage(assigned[current])
      }
      worker.onmessage = e => {
        replies[current] = e.data
        feed()
      }
      worker.onerror = () => {
        worker.terminate()
        resolve()
      }
      feed()
    })

  if (typeof Worker !== 'undefined') await Promise.all(Array.from({ length: size }, runWorker))
  assigned.forEach((job, i) => (replies[i] ??= parseSync(job)))

  const layers: ParsedLayer[] = []
  const errors: string[] = []
  for (const r of replies) r.ok ? layers.push(r.layer) : errors.push(r.error)
  return { layers, errors }
}
