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

/** Entrypoints из контракта: subpath → относительный путь import-файла. */
export function contractEntrypoints(root) {
  const contract = JSON.parse(readFileSync(join(root, 'release', 'contract.json'), 'utf8'));
  const entries = {};
  for (const [subpath, target] of Object.entries(contract.exports)) {
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
