import { parseLayer } from './parse'
import type { LayerFile, LayerId } from '../types'

self.onmessage = (e: MessageEvent<{ file: LayerFile; id: LayerId }>) => {
  const { file, id } = e.data
  try {
    self.postMessage({ ok: true, layer: parseLayer(file, id) })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : `${file.name}: ${String(err)}` })
  }
}
