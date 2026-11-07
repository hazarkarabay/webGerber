export type Side = 'top' | 'bottom' | 'both'
export type LayerType = 'copper' | 'soldermask' | 'silkscreen' | 'solderpaste' | 'drill' | 'outline' | 'milling'
export interface LayerId { side: Side; type: LayerType }
export interface LayerFile { name: string; text: string }
export type Pt = [number, number]
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export interface Stroke { points: Pt[]; width: number }
export interface Hole { x: number; y: number; d: number }
export interface ParsedLayer {
  file: string
  id: LayerId
  svgBody: string
  bounds: Box
  strokes: Stroke[]
  holes: Hole[]
  flashes: number // flashed apertures; on copper layers these are the pads
}
export interface Look {
  mask: string; matte: boolean; silk: string; finish: 'hasl' | 'enig'
  copperVisibility: number // copper under the mask: 1 = default, 0 = hidden
  background: string
  enabled: Record<string, boolean>
}
