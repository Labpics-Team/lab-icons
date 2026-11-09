import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { collectAnnulusNativeExportSurface } from './helpers/annulus-native-export-surface.js';
import { serializeExportSurface } from '../scripts/lib/export-surface.js';

it('native annulus modules expose exactly the snapshot entries observed by the canonical collector', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const snapshot = JSON.parse(readFileSync(new URL('../release/export-surface.json', import.meta.url), 'utf8'));
  const { surface, nativeSurface } = await collectAnnulusNativeExportSurface(root);
  expect(nativeSurface).toEqual(surface);
  const recorded = Object.fromEntries(Object.keys(surface).map(entry => [entry, snapshot[entry]]));
  expect(serializeExportSurface(recorded)).toBe(serializeExportSurface(surface));
});
