import * as THREE from 'three'
import type { Box, Pt } from '../types'

const T = 1.6

function orient(rings: Pt[][]): THREE.Vector2[][] {
  return rings.map((r, i) => {
    const pts = r.map(([x, y]) => new THREE.Vector2(x, y))
    if (THREE.ShapeUtils.isClockWise(pts) === (i === 0)) pts.reverse()
    return pts
  })
}

function geometry(attrs: Record<string, number[]>, index?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  for (const [name, a] of Object.entries(attrs)) g.setAttribute(name, new THREE.Float32BufferAttribute(a, name === 'uv' ? 2 : 3))
  if (index) g.setIndex(index)
  return g
}

export function buildBoardGroup(polygon: Pt[][][], box: Box) {
  const xy: THREE.Vector2[] = []
  const tri: number[] = []
  const wall: number[] = [], wallN: number[] = []
  for (const rings of polygon) {
    const [outer, ...holes] = orient(rings)
    const faces = THREE.ShapeUtils.triangulateShape(outer, holes)
    const base = xy.length
    for (const f of faces) tri.push(base + f[0], base + f[1], base + f[2])
    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length]
        const nx = q.y - p.y, ny = p.x - q.x, l = Math.hypot(nx, ny) || 1
        wall.push(p.x, p.y, 0, q.x, q.y, 0, q.x, q.y, T, p.x, p.y, 0, q.x, q.y, T, p.x, p.y, T)
        for (let k = 0; k < 6; k++) wallN.push(nx / l, ny / l, 0)
      }
    }
    xy.push(...outer, ...holes.flat())
  }
  const w = box.maxX - box.minX || 1, h = box.maxY - box.minY || 1
  const uv = xy.flatMap(p => [(p.x - box.minX) / w, (p.y - box.minY) / h])
  const flipped = tri.map((_, i) => tri[i - (i % 3) + [0, 2, 1][i % 3]])
  const cap = (z: number) => geometry({
    position: xy.flatMap(p => [p.x, p.y, z]),
    normal: xy.flatMap(() => [0, 0, z ? 1 : -1]),
    uv,
  }, z ? tri : flipped)
  const top = new THREE.Mesh(cap(T), new THREE.MeshStandardMaterial())
  const bottom = new THREE.Mesh(cap(0), new THREE.MeshStandardMaterial())
  const sides = new THREE.Mesh(geometry({ position: wall, normal: wallN }), new THREE.MeshStandardMaterial({ color: '#c2b280' }))
  const group = new THREE.Group()
  group.add(top, bottom, sides)
  group.rotation.x = -Math.PI / 2
  group.position.set(-(box.minX + box.maxX) / 2, -T / 2, (box.minY + box.maxY) / 2)
  return { group, top, bottom, sides }
}
