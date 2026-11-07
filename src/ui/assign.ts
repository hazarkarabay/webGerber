import { identifyLayer } from '../load/identify'
import type { LayerFile, LayerId, LayerType, Side } from '../types'

const L = (label: string, side: Side, type: LayerType) => ({ label, id: { side, type } as LayerId })

export const LAYERS = [
  L('Top silk', 'top', 'silkscreen'), L('Top mask', 'top', 'soldermask'),
  L('Top paste', 'top', 'solderpaste'), L('Top copper', 'top', 'copper'),
  L('Outline', 'both', 'outline'), L('Milling', 'both', 'milling'), L('Drill', 'both', 'drill'),
  L('Bottom copper', 'bottom', 'copper'), L('Bottom paste', 'bottom', 'solderpaste'),
  L('Bottom mask', 'bottom', 'soldermask'), L('Bottom silk', 'bottom', 'silkscreen'),
]

export const layerIndex = (id: LayerId | null) => {
  const i = id ? LAYERS.findIndex(l => l.id.side === id.side && l.id.type === id.type) : -1
  return i < 0 ? LAYERS.length : i
}

export interface Assigned { file: LayerFile; id: LayerId }

export function showAssign(el: HTMLElement, files: LayerFile[], skipped: string[], source: string, onView: (a: Assigned[]) => void): void {
  el.replaceChildren()
  const opened = document.createElement('p')
  opened.dataset.testid = 'assign-source'
  opened.append('Opened: ', Object.assign(document.createElement('b'), { textContent: source }))
  const hint = document.createElement('p')
  hint.className = 'note'
  hint.textContent = 'Check the layer assignments for each file and change if it needed then click View to see the 3D board.'
  el.append(opened, hint)
  const rows = files
    .map(file => ({ file, i: layerIndex(identifyLayer(file)) }))
    .sort((a, b) => a.i - b.i || a.file.name.localeCompare(b.file.name))
    .map(({ file, i }) => {
      const row = document.createElement('div')
      row.className = 'assign-row'
      row.dataset.testid = 'assign-row'
      const label = document.createElement('label')
      const name = document.createElement('span')
      name.textContent = file.name
      const select = document.createElement('select')
      for (const [j, l] of [...LAYERS, { label: 'Ignore' }].entries()) select.add(new Option(l.label, String(j), false, j === i))
      label.append(name, select)
      row.append(label)
      el.append(row)
      return { file, select }
    })

  if (skipped.length) {
    const p = document.createElement('p')
    p.className = 'note'
    p.textContent = `Skipped: ${skipped.join(', ')}`
    el.append(p)
  }

  const view = document.createElement('button')
  view.type = 'button'
  view.dataset.testid = 'view-btn'
  view.textContent = 'View'
  view.disabled = !files.length
  view.addEventListener('click', () =>
    onView(rows.filter(r => +r.select.value < LAYERS.length).map(r => ({ file: r.file, id: LAYERS[+r.select.value].id }))))
  el.append(view)
}
