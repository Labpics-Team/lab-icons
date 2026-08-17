/**
 * Lowers a declared model composition to the path operations that a renderer
 * actually evaluates. Seeing gates must consume this contract instead of
 * concatenating `d`: concatenation turns independent layers or overlapping
 * subtractors into an unrelated even-odd XOR shape.
 */

const FILL_RULES = new Set(['nonzero', 'evenodd']);

function normalizedParts(parts, label) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new TypeError(`${label}: parts must be a non-empty array`);
  }
  const ids = new Set();
  for (const part of parts) {
    if (!part || typeof part.id !== 'string' || part.id.length === 0) {
      throw new TypeError(`${label}: every part must have a non-empty id`);
    }
    if (ids.has(part.id)) throw new Error(`${label}: duplicate part id ${part.id}`);
    ids.add(part.id);
    if (typeof part.d !== 'string' || part.d.trim() === '') {
      throw new TypeError(`${label}: part ${part.id} must carry path data`);
    }
  }
  return { ids, byId: new Map(parts.map((part) => [part.id, part])) };
}

function independentEntry(part, operation) {
  const fillRule = part.fillRule ?? 'nonzero';
  if (!FILL_RULES.has(fillRule)) {
    throw new TypeError(`model-composition: part ${part.id} has invalid fill rule ${String(fillRule)}`);
  }
  return {
    d: part.d,
    fillRule,
    operation,
    partId: part.id,
    role: part.role ?? null,
  };
}

/**
 * @param {{
 *   built?: string,
 *   parts: Array<{id:string,d:string,fillRule?:'nonzero'|'evenodd',role?:string}>,
 *   composition: {kind:string,fillRule?:string,basePartIds?:string[],subtractPartIds?:string[]},
 *   label?: string,
 * }} input
 * @returns {Array<{d:string,fillRule:'nonzero'|'evenodd',operation:'union'|'subtract',partId?:string,role?:string|null}>}
 */
export function lowerModelComposition({ built = null, parts, composition, label = 'model-composition' }) {
  if (!composition || typeof composition.kind !== 'string') {
    throw new TypeError(`${label}: composition must be declared`);
  }
  const { ids, byId } = normalizedParts(parts, label);

  if (composition.kind === 'compound') {
    if (!FILL_RULES.has(composition.fillRule)) {
      throw new TypeError(`${label}: compound composition has invalid fill rule`);
    }
    if (typeof built !== 'string' || built.trim() === '') {
      throw new TypeError(`${label}: compound composition requires materialized path data`);
    }
    return [{ d: built, fillRule: composition.fillRule, operation: 'union' }];
  }

  if (composition.kind === 'layers') {
    return parts.map((part) => independentEntry(part, 'union'));
  }

  if (composition.kind === 'mask-subtract') {
    const basePartIds = composition.basePartIds;
    const subtractPartIds = composition.subtractPartIds;
    if (
      !Array.isArray(basePartIds) ||
      !Array.isArray(subtractPartIds) ||
      basePartIds.length === 0 ||
      subtractPartIds.length === 0
    ) {
      throw new TypeError(`${label}: mask-subtract must declare basePartIds and subtractPartIds`);
    }
    const classified = [...basePartIds, ...subtractPartIds];
    if (
      new Set(classified).size !== classified.length ||
      classified.length !== ids.size ||
      classified.some((id) => !byId.has(id))
    ) {
      throw new Error(`${label}: mask-subtract must classify every part exactly once`);
    }
    const subtract = new Set(subtractPartIds);
    return parts.map((part) => independentEntry(part, subtract.has(part.id) ? 'subtract' : 'union'));
  }

  throw new Error(`${label}: unknown composition ${composition.kind}`);
}
