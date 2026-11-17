import type { SymbolData, SymbolPart, IconVariant } from './index.js';
import { opticalPathData, sampleOpticalPath, sampleOpticalScalar, type OpticalPosition } from './optical-grid.js';

/** Pure serialization of compiled parts, with one tint application per coverage layer. */
export function renderSymbolParts(data: SymbolData, variant: IconVariant, parts: readonly SymbolPart[], at: OpticalPosition): string {
  const layers = new Map<string, SymbolPart[]>();
  for (const part of parts) {
    const key = part.layer ?? part.key;
    if (!layers.has(key)) layers.set(key, []);
    layers.get(key)!.push(part);
  }
  let result = '';
  for (const entries of layers.values()) {
    const isolated = entries[0]!.layer !== undefined;
    const paths = [...entries].sort((a, b) => Number(!!a.negative) - Number(!!b.negative)).map(part => {
      const path = data.variants[variant].paths[part.pathIndex]!;
      const color = isolated ? part.negative ? 'black' : 'white' : 'currentColor';
      const paint = path.stroke ? `fill="none" stroke="${color}" stroke-width="${sampleOpticalScalar(path.stroke.width, at)}" stroke-linecap="round" stroke-linejoin="round"`
        : `fill="${color}"`;
      const offset = part.offsetX ? ` transform="translate(${sampleOpticalScalar(part.offsetX, at)} 0)"` : '';
      return `<path d="${opticalPathData(path, sampleOpticalPath(path, at), part.contourIndices)}" fill-rule="${path.fillRule}" ${paint}${offset}/>`;
    }).join('');
    if (!isolated) result += paths;
    else {
      const identity = entries.map(part => part.key).join('-').replace(/[^a-zA-Z0-9_-]/g, '_');
      const id = `lab-icon-${identity}-${at.weightSide}-${at.weight}-${at.opszSide}-${at.opsz}`;
      result += `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-24" y="-24" width="72" height="72">${paths}</mask></defs><rect x="-24" y="-24" width="72" height="72" mask="url(#${id})"/>`;
    }
  }
  return result;
}
