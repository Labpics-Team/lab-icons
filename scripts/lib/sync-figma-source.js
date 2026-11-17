import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { authorIconNames, authorMasterVersion, loadAuthorBaseline } from './author-baseline.js';
import { loadSymbolSource, SYMBOL_VARIANTS, verifySymbolComponents, writeSymbolSourceProjections } from './symbol-source.js';

/** Import a read-only Figma capture. Only changed master bytes are copied.
 * Existing master paths are immutable; unchanged shapes retain their capture version.
 * A changed shape loses its old semantic annotation rather than inheriting guesses.
 */
export function syncFigmaSource({ root, captureRoot, manifest, write = false }) {
  const source = loadSymbolSource(root);
  const names = authorIconNames(manifest);
  const existing = Object.keys(source.symbols).sort();
  if (JSON.stringify(names) !== JSON.stringify(existing)) throw new Error('Figma sync: family additions/removals require an explicit corpus migration');
  if (manifest.source.fileKey !== source.capture.source.fileKey) throw new Error('Figma sync: capture belongs to another file');
  // Validates receipts, normalized source and path fingerprints before writing anything.
  const captured = loadAuthorBaseline(captureRoot, { manifest });
  const next = structuredClone(source), changes = [], staged = new Map();
  for (const id of names) for (const variant of SYMBOL_VARIANTS) {
    const previous = source.symbols[id].variants[variant];
    const incoming = manifest.icons[id][variant];
    const same = previous.provenance.sha256 === incoming.sha256;
    if (same) {
      next.symbols[id].variants[variant].provenance.version = authorMasterVersion(previous.provenance, source.capture.source);
      continue;
    }
    if (source.symbols[id].opticalMaster) {
      throw new Error(`Figma sync: changed ${id}/${variant} requires review of its optical masters before import`);
    }
    const destination = resolve(root, incoming.master);
    if (!destination.startsWith(`${resolve(root)}${sep}`)) throw new Error('Figma sync: master path escapes repository');
    const bytes = Buffer.from(captured.icons[id][variant].rawSvg);
    if (existsSync(destination) && !readFileSync(destination).equals(bytes)) throw new Error(`Figma sync: immutable master would be overwritten: ${incoming.master}`);
    const sourceShape = captured.icons[id][variant];
    const sameContours = previous.provenance.normalizedSource.pathFingerprintSha256 === incoming.normalizedSource.pathFingerprintSha256;
    const anatomy = sameContours ? structuredClone(previous.anatomy) : {
      classification: 'unclassified',
      parts: sourceShape.sourceContract.parts.map((part, pathIndex) => ({ pathIndex, id: `path-${pathIndex + 1}`, role: 'unclassified' })),
    };
    if (anatomy.masterSha256) anatomy.masterSha256 = incoming.sha256;
    next.symbols[id].variants[variant] = { provenance: { ...incoming, style: previous.provenance.style }, anatomy };
    changes.push({ id, variant, geometryChanged: !sameContours, master: incoming.master });
    staged.set(destination, bytes);
  }
  const { icons: _icons, counts: _counts, ...capture } = manifest;
  next.capture = capture;
  next.compatibility.annotationHeader.source = { fileKey: manifest.source.fileKey, version: manifest.source.version };
  next.compatibility.stateGroups.source = { fileKey: manifest.source.fileKey, version: manifest.source.version };
  // An importer cannot preserve state recipes whose authored parts changed.
  for (const group of Object.values(next.compatibility.stateGroups.groups)) {
    for (const state of Object.values(group.states)) {
      const change = changes.find(item => item.id === state.icon && item.variant === state.variant);
      if (change) throw new Error(`Figma sync: changed ${state.icon}/${state.variant} requires review of its state group before import`);
    }
  }
  verifySymbolComponents(next, root, path => staged.get(path) ?? readFileSync(path));
  if (write) {
    for (const [path, bytes] of staged) if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes, { flag: 'wx' });
    }
    const target = join(root, 'symbols/source.json'), temporary = `${target}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
    writeSymbolSourceProjections(root);
  }
  return { mode: write ? 'write' : 'check', families: names.length, unchanged: names.length * 2 - changes.length,
    changed: changes, sourceSha256: createHash('sha256').update(JSON.stringify(next)).digest('hex') };
}
