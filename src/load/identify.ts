import type { LayerFile, LayerId, LayerType, Side } from '../types'

const id = (side: Side, type: LayerType): LayerId => ({ side, type })

const EXT: Record<string, LayerId> = {
  gtl: id('top', 'copper'), gbl: id('bottom', 'copper'),
  gto: id('top', 'silkscreen'), gbo: id('bottom', 'silkscreen'),
  gts: id('top', 'soldermask'), gbs: id('bottom', 'soldermask'),
  gtp: id('top', 'solderpaste'), gbp: id('bottom', 'solderpaste'),
  gko: id('both', 'outline'), gm1: id('both', 'outline'), gml: id('both', 'milling'),
  xln: id('both', 'drill'), drl: id('both', 'drill'), drd: id('both', 'drill'), exc: id('both', 'drill'),
  cmp: id('top', 'copper'), sol: id('bottom', 'copper'),
  plc: id('top', 'silkscreen'), pls: id('bottom', 'silkscreen'),
  stc: id('top', 'soldermask'), sts: id('bottom', 'soldermask'),
  crc: id('top', 'solderpaste'), crs: id('bottom', 'solderpaste'),
}

const X2_TYPE: Record<string, LayerType> = {
  copper: 'copper', soldermask: 'soldermask', legend: 'silkscreen', paste: 'solderpaste',
}

function fromX2(fn: string): LayerId | null {
  const [kind, ...rest] = fn.split(',').map(s => s.trim().toLowerCase())
  if (kind === 'profile') return id('both', 'outline')
  if (kind === 'plated' || kind === 'nonplated') return id('both', 'drill')
  const type = X2_TYPE[kind]
  if (!type) return null
  const side = rest.includes('top') ? 'top' : rest.includes('bot') ? 'bottom' : null
  return side && id(side, type)
}

function isDrillText(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('%') || s.startsWith(';')) continue
    return s.startsWith('M48')
  }
  return false
}

function fromName(name: string): LayerId | null {
  const n = name.toLowerCase()
  if (/(^|[^a-z])(in\d|inner)/.test(n)) return null
  let type: LayerType | null = null
  if (/edge|outline|profile/.test(n)) type = 'outline'
  else if (/mill/.test(n)) type = 'milling'
  else if (/paste/.test(n)) type = 'solderpaste'
  else if (/mask/.test(n)) type = 'soldermask'
  else if (/silk|legend/.test(n)) type = 'silkscreen'
  else if (/copper|(^|[^a-z])cu([^a-z]|$)/.test(n)) type = 'copper'
  if (!type) return null
  if (type === 'outline' || type === 'milling') return id('both', type)
  const side = /(^|[^a-z])(b_|bot)/.test(n) ? 'bottom' : /(^|[^a-z])(f_|top)/.test(n) ? 'top' : null
  return side && id(side, type)
}

export function identifyLayer(file: LayerFile): LayerId | null {
  const x2 = /(?:%|#@! )TF\.FileFunction,([^*%\r\n]*)/.exec(file.text)
  const fromFn = x2 && fromX2(x2[1])
  if (fromFn || (x2 && /^\s*copper/i.test(x2[1]))) return fromFn
  const ext = /\.([^.\/]+)$/.exec(file.name)?.[1].toLowerCase() ?? ''
  if (ext === 'txt') return isDrillText(file.text) ? id('both', 'drill') : null
  return EXT[ext] ?? fromName(file.name.replace(/\.[^.]*$/, ''))
}
