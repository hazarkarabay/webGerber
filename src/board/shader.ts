import * as THREE from 'three'
import type { Look } from '../types'
import { FINISHES, PASTE, SILKS, SUBSTRATE, maskColor } from './palette'

const mix = (a: string, b: string, t: number): string => {
  const c = (s: string, i: number) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16)
  return '#' + [0, 1, 2].map(i => Math.round(c(a, i) * (1 - t) + c(b, i) * t).toString(16).padStart(2, '0')).join('')
}

// sRGB hex colors the board shader mixes; copper under the mask is the mask color lightened toward white
export function boardColors(look: Look) {
  const mask = maskColor(look)
  return {
    uMask: mask,
    uUnder: mix(mask, '#ffffff', 0.08 * look.copperVisibility),
    uSubstrate: SUBSTRATE,
    uFinish: (FINISHES.find(f => f.id === look.finish) ?? FINISHES[0]).color,
    uSilk: (SILKS.find(s => s.id === look.silk) ?? SILKS[0]).color,
    uPaste: PASTE,
  }
}

export type BoardUniforms = Record<keyof ReturnType<typeof boardColors>, { value: THREE.Color }>

export const createBoardUniforms = (): BoardUniforms => ({
  uMask: { value: new THREE.Color() }, uUnder: { value: new THREE.Color() }, uSubstrate: { value: new THREE.Color() },
  uFinish: { value: new THREE.Color() }, uSilk: { value: new THREE.Color() }, uPaste: { value: new THREE.Color() },
})

export function setBoardColors(u: BoardUniforms, look: Look): void {
  for (const [k, hex] of Object.entries(boardColors(look))) u[k as keyof BoardUniforms].value.set(hex)
}

// map holds coverage (r copper, g mask opening, b silk); roughnessMap.r holds paste. Colors come from uniforms,
// so color changes never re-rasterize the board images.
const MIX_GLSL = `
#if defined( USE_MAP ) && defined( USE_ROUGHNESSMAP )
  vec3 cov = texture2D( map, vMapUv ).rgb;
  vec2 dUv = ( vMapUv - uDetailRect.xy ) / max( uDetailRect.zw, vec2( 1e-6 ) );
  if ( uDetailRect.z > 0.0 && all( greaterThanEqual( dUv, vec2( 0.0 ) ) ) && all( lessThanEqual( dUv, vec2( 1.0 ) ) ) ) cov = texture2D( uDetail, dUv ).rgb;
  vec3 board = mix( uMask, uUnder, cov.r );
  board = mix( board, mix( uSubstrate, uFinish, cov.r ), cov.g );
  board = mix( board, uPaste, texture2D( roughnessMap, vRoughnessMapUv ).r );
  board = mix( board, uSilk, cov.b );
  diffuseColor.rgb *= board;
#endif
`

// per side: a sharper coverage image of the visible region when zoomed in; rect is (u, v, width, height), width 0 = off
export type DetailUniforms = { uDetail: { value: THREE.Texture | null }; uDetailRect: { value: THREE.Vector4 } }

export function useBoardShader(mat: THREE.MeshStandardMaterial, u: BoardUniforms): DetailUniforms {
  const detail: DetailUniforms = { uDetail: { value: null }, uDetailRect: { value: new THREE.Vector4() } }
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u, detail)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uMask, uUnder, uSubstrate, uFinish, uSilk, uPaste;\nuniform sampler2D uDetail;\nuniform vec4 uDetailRect;')
      .replace('#include <map_fragment>', MIX_GLSL)
  }
  return detail
}
