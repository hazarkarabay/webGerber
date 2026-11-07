import { difference, xor } from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import type { Box, ParsedLayer, Pt, Stroke } from '../types'

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

function chain(strokes: Stroke[], tol: number): { loops: Pt[][]; members: Stroke[][]; open: Stroke[] } {
  const used = strokes.map(() => false)
  const loops: Pt[][] = []
  const loopMembers: Stroke[][] = []
  const open: Stroke[] = []
  for (let i = 0; i < strokes.length; i++) {
    if (used[i]) continue
    used[i] = true
    const members = [strokes[i]]
    const pts = [...strokes[i].points]
    let w = strokes[i].width
    for (;;) {
      const end = pts[pts.length - 1]
      if (pts.length > 2 && dist(pts[0], end) <= Math.max(tol, w / 2)) {
        pts.pop()
        if (pts.length > 2) { loops.push(pts); loopMembers.push(members) }
        break
      }
      let best = -1, bestD = Infinity, rev = false
      strokes.forEach((s, j) => {
        if (used[j]) return
        const t = Math.max(tol, w / 2, s.width / 2)
        const d0 = dist(s.points[0], end), d1 = dist(s.points[s.points.length - 1], end)
        if (d0 <= t && d0 < bestD) { best = j; bestD = d0; rev = false }
        if (d1 <= t && d1 < bestD) { best = j; bestD = d1; rev = true }
      })
      if (best < 0) { open.push(...members); break }
      used[best] = true
      const s = strokes[best]
      members.push(s)
      w = Math.max(w, s.width)
      pts.push(...(rev ? [...s.points].reverse() : s.points).slice(1))
    }
  }
  return { loops, members: loopMembers, open }
}

export function chainLoops(strokes: Stroke[], tol = 0.01): Pt[][] {
  return chain(strokes, tol).loops
}

const area = (r: Pt[]) => Math.abs(r.reduce((s, p, i) => {
  const q = r[(i + 1) % r.length]
  return s + p[0] * q[1] - q[0] * p[1]
}, 0)) / 2

export const boardArea = (polygon: Pt[][][]) =>
  polygon.reduce((s, [outer, ...holes]) => s + area(outer) - holes.reduce((t, h) => t + area(h), 0), 0)

const ringBox = (r: Pt[]): Box => ({
  minX: Math.min(...r.map(p => p[0])), minY: Math.min(...r.map(p => p[1])),
  maxX: Math.max(...r.map(p => p[0])), maxY: Math.max(...r.map(p => p[1])),
})

const arc = (c: Pt, r: number, a0: number, n: number): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos(a0 + (Math.PI * i) / n), c[1] + r * Math.sin(a0 + (Math.PI * i) / n)])

function stadiums(s: Stroke): Polygon[] {
  const r = s.width / 2
  const out: Polygon[] = []
  for (let i = 0; i < Math.max(1, s.points.length - 1); i++) {
    const a = s.points[i], b = s.points[i + 1] ?? a
    const t = Math.atan2(b[1] - a[1], b[0] - a[0])
    // a continuing segment skips its start cap: the previous end cap already covers the joint
    out.push([[...arc(b, r, t - Math.PI / 2, 16), ...arc(a, r, t + Math.PI / 2, i === 0 ? 16 : 1)]])
  }
  return out
}

const boxOf = (pts: Pt[]): Box => pts.length ? ringBox(pts) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }

const same = (a: Pt[], b: Pt[]) => {
  const ba = ringBox(a), bb = ringBox(b)
  return Math.abs(ba.minX - bb.minX) <= 0.01 && Math.abs(ba.minY - bb.minY) <= 0.01 &&
    Math.abs(ba.maxX - bb.maxX) <= 0.01 && Math.abs(ba.maxY - bb.maxY) <= 0.01 &&
    Math.abs(area(a) - area(b)) <= 0.001 * Math.max(area(a), area(b))
}

export function clipBoard(edge: MultiPolygon, cutoutSets: Polygon[][], diff = difference): MultiPolygon {
  for (const cutouts of cutoutSets) {
    try {
      return diff(edge, ...cutouts)
    } catch {
      // polygon-clipping throws on some degenerate input; retry with fewer cutouts
    }
  }
  return edge
}

export function buildBoardPolygon(layers: ParsedLayer[]): { polygon: Pt[][][]; box: Box } {
  const of = (t: string) => layers.filter(l => l.id.type === t)
  const outline = of('outline').map(l => chain(l.strokes, 0.01))
  const milling = of('milling').map(l => ({
    loops: chainLoops(l.strokes.filter(s => s.width === 0)),
    slots: l.strokes.filter(s => s.width > 0),
    wide: chain(l.strokes.filter(s => s.width > 0), 0.01),
  }))
  const dedupe = (rs: Pt[][]) => rs.filter((r, i) => !rs.slice(0, i).some(q => same(q, r)))
  let outlineLoops = dedupe(outline.flatMap(o => o.loops))
  const copper = of('copper').filter(l => l.bounds.maxX > l.bounds.minX)
  const fits = (b: Box, c: Box, tol = 0.5) =>
    c.minX >= b.minX - tol && c.minY >= b.minY - tol && c.maxX <= b.maxX + tol && c.maxY <= b.maxY + tol
  const board = copper.length ? outlineLoops.filter(r => copper.every(l => fits(ringBox(r), l.bounds)))
    .reduce<Pt[] | undefined>((m, r) => (!m || area(r) < area(m) ? r : m), undefined) : undefined
  if (board) outlineLoops = outlineLoops.filter(r => r === board || !fits(ringBox(r), ringBox(board), 0.01))
  let millingLoops = dedupe(milling.flatMap(m => m.loops)).filter(r => !outlineLoops.some(q => same(q, r)))
  let slots = [
    ...outline.flatMap(o => o.open.filter(s => s.width > 0)),
    ...milling.flatMap(m => m.slots),
    ...of('drill').flatMap(l => l.strokes.filter(s => s.width > 0)),
  ]
  const valid = layers.filter(l => l.bounds.maxX > l.bounds.minX && l.bounds.maxY > l.bounds.minY)

  let edge: MultiPolygon = []
  if (outlineLoops.length) {
    try {
      edge = xor([], ...outlineLoops.map(r => [r]))
    } catch {
      edge = [[outlineLoops.reduce((m, r) => (area(r) > area(m) ? r : m))]]
    }
    // closed glyphs of dimension text (Eagle layer 20) would float as separate pieces
    const big = Math.max(...edge.map(p => area(p[0])))
    edge = edge.filter(p => area(p[0]) >= big / 100)
  } else {
    const largest = (rs: Pt[][]) => rs.reduce<Pt[] | undefined>((m, r) => (!m || area(r) > area(m) ? r : m), undefined)
    const enclosesAll = (r: Pt[]) => valid.every(l => l.id.type === 'milling' || fits(ringBox(r), l.bounds))
    const m = largest(millingLoops)
    // a board contour milled with a tool-width line (e.g. Eagle layer 46) is a closed wide loop
    const wide = largest(milling.flatMap(x => x.wide.loops).filter(enclosesAll))
    if (m && enclosesAll(m)) {
      edge = [[m]]
      millingLoops = millingLoops.filter(r => r !== m)
    } else if (wide) {
      edge = [[wide]]
      const used = milling.flatMap(x => x.wide.members[x.wide.loops.indexOf(wide)] ?? [])
      slots = slots.filter(s => !used.includes(s))
    } else if (valid.length) {
      const u = boxOf(valid.flatMap(l => [[l.bounds.minX, l.bounds.minY], [l.bounds.maxX, l.bounds.maxY]] as Pt[]))
      edge = [[[[u.minX, u.minY], [u.maxX, u.minY], [u.maxX, u.maxY], [u.minX, u.maxY]]]]
    }
  }
  if (!edge.length) return { polygon: [], box: boxOf([]) }

  const circle = (x: number, y: number, d: number, n = Math.min(32, Math.max(8, Math.ceil(d * 2) * 4))): Pt[] =>
    Array.from({ length: n }, (_, i) => [x + (d / 2) * Math.cos((2 * Math.PI * i) / n), y + (d / 2) * Math.sin((2 * Math.PI * i) / n)])
  const holes: Polygon[] = of('drill').flatMap(l => l.holes).filter(h => h.d > 0).map(h => [circle(h.x, h.y, h.d)])
  const cutouts: Polygon[] = [...millingLoops.map(r => [r]), ...slots.flatMap(stadiums), ...holes]
  const region = clipBoard(edge, [cutouts, holes])
  // polygon-clipping returns closed rings (last point == first); drop the duplicate
  const open = (mp: MultiPolygon) => mp.map(p => p.map(r => r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r))
  return { polygon: open(region), box: boxOf(edge.flat(2)) }
}

export function pointInBoard(polygon: Pt[][][], p: Pt): boolean {
  let inside = false
  for (const ring of polygon.flat()) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}
