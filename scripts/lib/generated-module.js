import { gzipSync, strToU8 } from 'fflate';

const measure = text => {
  const bytes = strToU8(text);
  return { text, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length };
};

/** Build-only выбор равнозначных представлений; ни raw, ни pinned gzip не растут. */
export function compactGeneratedModule(layouts) {
  const baseline = measure(layouts[0]);
  let selected = baseline;
  for (const layout of layouts) {
    const candidate = measure(layout);
    if (candidate.bytes <= baseline.bytes && candidate.gzipBytes <= baseline.gzipBytes &&
        (candidate.gzipBytes < selected.gzipBytes ||
          candidate.gzipBytes === selected.gzipBytes && candidate.bytes < selected.bytes)) selected = candidate;
  }
  return selected.text;
}

const JS_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
export const literalKey = key => key === '__proto__' ? `[${JSON.stringify(key)}]`
  : JS_KEY.test(key) ? key : JSON.stringify(key);

/** JSON materialization остаётся build-only; PURE выражения сюда не поступают. */
export function compactDataLiteral(value) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return undefined;
  const emit = item => Array.isArray(item) ? `[${item.map(emit).join(',')}]`
    : item !== null && typeof item === 'object'
      ? `{${Object.entries(item).map(([key, child]) => `${literalKey(key)}:${emit(child)}`).join(',')}}`
      : JSON.stringify(item);
  return emit(JSON.parse(encoded));
}
