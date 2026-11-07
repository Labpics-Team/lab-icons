/**
 * export-surface: рантайм-поверхность ESM-экспортов пакета.
 *
 * Инвариант: множество runtime-экспортов каждого entrypoint из
 * release/contract.json#exports зафиксировано снапшотом
 * release/export-surface.json. d.ts (stripInternal) может скрыть утечку —
 * рантайм-модуль нет, поэтому источником истины служит dynamic import
 * собранного dist, а не типы.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expandReleaseExports } from './release-contract.js';

/** Снимок обязан покрывать каждый публичный entrypoint до чтения runtime-файлов. */
export function exportSurfaceEntryErrors(contract, surface) {
  if (!surface || typeof surface !== 'object' || Array.isArray(surface)) {
    return ['export-surface: снимок обязан быть объектом entrypoints'];
  }
  const entries = Object.keys(expandReleaseExports(contract));
  const missing = entries.filter(entry => !Object.hasOwn(surface, entry));
  const extra = Object.keys(surface).filter(entry => !entries.includes(entry));
  return [
    ...missing.map(entry => `export-surface: отсутствует публичный entrypoint ${entry}`),
    ...extra.map(entry => `export-surface: неизвестный entrypoint ${entry}`),
  ];
}

/** Entrypoints из контракта: subpath → относительный путь import-файла. */
export function contractEntrypoints(root) {
  const contract = JSON.parse(readFileSync(join(root, 'release', 'contract.json'), 'utf8'));
  const entries = {};
  for (const [subpath, target] of Object.entries(expandReleaseExports(contract))) {
    if (typeof target?.import !== 'string') {
      throw new Error(`export-surface: у entrypoint «${subpath}» нет поля import в release/contract.json`);
    }
    entries[subpath] = target.import;
  }
  return entries;
}

/** Фактическая поверхность: subpath → отсортированные runtime-экспорты dist. */
export async function collectExportSurface(root) {
  const surface = {};
  for (const [subpath, importPath] of Object.entries(contractEntrypoints(root))) {
    // Кэш-бастер: в одном процессе (generate → check) модуль мог измениться.
    const url = `${pathToFileURL(join(root, importPath)).href}?surface=${Date.now()}`;
    const mod = await import(url);
    surface[subpath] = Object.keys(mod).sort();
  }
  return surface;
}

export function serializeExportSurface(surface) {
  const ordered = Object.fromEntries(
    Object.keys(surface).sort().map((k) => [k, surface[k]]),
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
