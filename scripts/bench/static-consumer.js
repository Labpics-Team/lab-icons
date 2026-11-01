import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync } from 'node:zlib';

/** Строка literal принадлежит тому же installed artifact, что named export. */
export function staticAdapterSource(variant, svg) {
  if (!['outline', 'filled'].includes(variant)) throw new TypeError('benchmark: неизвестный static variant');
  if (svg === undefined) return `export { ${variant} as svg } from '@labpics/icons/symbols/accessibility';\n`;
  if (typeof svg !== 'string' || !svg.startsWith('<svg') || !svg.includes('</svg>')) throw new TypeError('benchmark: literal обязан содержать actual SVG');
  return `export const svg = ${JSON.stringify(svg)};\n`;
}

/** Parsed inputs не выдаются за retained runtime; компрессоры совпадают у всех lanes. */
export function bundleMeasurements(bytes, metafile) {
  const retained = new Map();
  for (const output of Object.values(metafile.outputs)) for (const [file, input] of Object.entries(output.inputs)) {
    if (input.bytesInOutput > 0) retained.set(file, (retained.get(file) ?? 0) + input.bytesInOutput);
  }
  return { rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes).length, sha256: createHash('sha256').update(bytes).digest('hex'),
    inputs: Object.entries(metafile.inputs).map(([file, input]) => ({ file, bytes: input.bytes })),
    retainedInputs: [...retained].map(([file, bytesInOutput]) => ({ file, bytesInOutput })),
    compressors: { gzip: 'node:zlib level 9', brotli: 'node:zlib defaults' } };
}
