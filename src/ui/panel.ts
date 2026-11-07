import { BACKGROUNDS, FINISHES, MASKS, SILKS, paintBackground } from '../board/palette'
import type { Look, ParsedLayer } from '../types'
import { LAYERS, layerIndex } from './assign'

export type Change = 'geometry' | 'texture' | 'color' | 'background'

const GEOMETRY = new Set(['outline', 'milling', 'drill'])

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, testid?: string) {
  const e: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props)
  if (testid) (e as HTMLElement).dataset.testid = testid
  return e
}

function section(title: string, ...children: Node[]): HTMLDetailsElement {
  const d = el('details', { open: true })
  d.append(el('summary', { textContent: title }), ...children)
  return d
}

function swatches(
  items: { id: string; label: string; css: string }[], testid: string, current: string,
  custom: HTMLInputElement | null, pick: (id: string) => void,
): HTMLElement {
  const wrap = el('div', { className: 'swatches' })
  const buttons = items.map(it => {
    const b = el('button', { type: 'button', className: 'swatch', title: it.label }, testid)
    b.dataset.id = it.id
    b.style.background = it.css
    b.setAttribute('aria-label', it.label)
    b.addEventListener('click', () => select(it.id))
    return b
  })
  const box = custom && customBox(custom)
  const mark = (id: string) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.id === id))
    box?.classList.toggle('active', !buttons.some(b => b.dataset.id === id))
  }
  const select = (id: string) => { mark(id); pick(id) }
  mark(current)
  custom?.addEventListener('input', () => select(custom.value))
  wrap.append(...buttons)
  if (box) wrap.append(box)
  return wrap
}

const EYEDROPPER = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>'

function customBox(input: HTMLInputElement): HTMLElement {
  const box = el('label', { className: 'swatch custom', title: input.getAttribute('aria-label') ?? '' })
  box.innerHTML = EYEDROPPER
  const paint = () => {
    box.style.background = input.value
    const [r, g, b] = [1, 3, 5].map(i => parseInt(input.value.slice(i, i + 2), 16))
    box.style.color = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff'
  }
  input.addEventListener('input', paint)
  paint()
  box.append(input)
  return box
}

function radios(name: string, items: { id: string; label: string }[], testid: string, current: string, pick: (id: string) => void) {
  const fs: HTMLElement = el('div', { className: 'radios' })
  fs.setAttribute('role', 'radiogroup')
  fs.setAttribute('aria-label', name)
  for (const it of items) {
    const input = el('input', { type: 'radio', name, value: it.id, checked: it.id === current }, testid)
    input.addEventListener('change', () => pick(it.id))
    const label: HTMLElement = el('label')
    label.append(input, ' ' + it.label)
    fs.append(label)
  }
  return fs
}

const hex = (v: string) => /^#[0-9a-f]{6}$/i.test(v) ? v : undefined

const bgPreview = (id: string) => {
  const c = el('canvas', { width: 24, height: 24 })
  paintBackground(c.getContext('2d')!, 24, 24, id)
  return `url(${c.toDataURL()})`
}

export function buildPanel(
  root: HTMLElement, layers: ParsedLayer[], look: Look,
  changed: (c: Change) => void, exportAs: (kind: 'jpg' | 'png') => void,
): HTMLElement {
  root.replaceChildren()

  const layerList = el('div', { className: 'layers' })
  for (const l of [...layers].sort((a, b) => layerIndex(a.id) - layerIndex(b.id))) {
    const cb = el('input', { type: 'checkbox', checked: look.enabled[l.file] !== false }, 'layer-toggle')
    cb.dataset.file = l.file
    cb.addEventListener('change', () => {
      look.enabled[l.file] = cb.checked
      changed(GEOMETRY.has(l.id.type) ? 'geometry' : 'texture')
    })
    const label = el('label', { title: l.file })
    label.append(cb, ` ${LAYERS[layerIndex(l.id)].label} `, el('small', { textContent: l.file }))
    layerList.append(label)
  }

  const maskCustom = el('input', { type: 'color', value: hex(look.mask) ?? '#005228' }, 'mask-custom')
  maskCustom.setAttribute('aria-label', 'Custom mask color')
  const masks = swatches(MASKS.map(m => ({ id: m.id, label: m.label, css: m.color })), 'mask-swatch', look.mask, maskCustom, id => {
    const matte = MASKS.find(m => m.id === id)?.matte ?? false
    const matteChanged = matte !== look.matte
    look.mask = id
    look.matte = matte
    changed(matteChanged ? 'texture' : 'color')
  })

  const copper = el('input', { type: 'range', min: '0', max: '200', step: '5', value: String(Math.round(look.copperVisibility * 100)) }, 'copper-visibility')
  copper.addEventListener('input', () => { look.copperVisibility = +copper.value / 100; changed('color') })
  const copperLabel = el('label', { className: 'slider', textContent: 'Copper visibility ' })
  copperLabel.append(copper)

  const silk = swatches(SILKS.map(s => ({ id: s.id, label: s.label, css: s.color })), 'silk-swatch', look.silk, null, id => { look.silk = id; changed('color') })
  const finish = radios('Finish', FINISHES, 'finish-option', look.finish, id => {
    look.finish = id as Look['finish']
    changed('texture')
  })

  const bgCustom = el('input', { type: 'color', value: hex(look.background) ?? '#808080' }, 'bg-custom')
  bgCustom.setAttribute('aria-label', 'Custom background color')
  const bgs = swatches(BACKGROUNDS.map(b => ({ id: b.id, label: b.label, css: bgPreview(b.id) })), 'bg-swatch', look.background, bgCustom, id => {
    look.background = id
    changed('background')
  })

  const jpg = el('button', { type: 'button', textContent: 'JPG (with background)' }, 'export-jpg')
  jpg.addEventListener('click', () => exportAs('jpg'))
  const png = el('button', { type: 'button', textContent: 'PNG (transparent, hi-res)' }, 'export-png')
  png.addEventListener('click', () => exportAs('png'))
  const info = el('dl', { className: 'info' }, 'board-info')

  root.append(
    section('Layers', layerList),
    section('Solder mask', masks, copperLabel),
    section('Silk', silk),
    section('Finish', finish),
    section('Background', bgs),
    section('Info', info),
    section('Export', jpg, png),
  )
  return info
}
