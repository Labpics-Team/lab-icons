import { expect, it } from 'vitest';
import { draftOpticalFields, inspectOpticalPaths } from '../scripts/lib/optical-drafts.js';
import { opticalRecipeMasters } from '../scripts/lib/optical-recipes.js';
import { compileOpticalGrid } from '../scripts/lib/optical-grid.js';
import { compileOpticalCorpus } from '../scripts/lib/optical-corpus.js';
import { fileURLToPath } from 'node:url';

const axes = { weight: [300, 400, 600], opsz: [16, 24, 48] };
const profile = { weightOffset: [-0.2, 0, 0.2], opszOffset: [0.05, 0, -0.02],
  counterOpszOffset: [-0.05, 0, 0.02], spanScale: [1, 1, 1] };
const project = source => opticalRecipeMasters({ axes, source, recipes: [], fields: draftOpticalFields(source), fieldProfile: profile });

it('uses actual evenodd ink side when an interior contour has the same winding', () => {
  const source = [{ d: 'M1 1L23 1L23 23L1 23ZM5 5L19 5L19 19L5 19Z', fillRule: 'evenodd' }];
  const fields = draftOpticalFields(source);
  expect(fields[0].contours.map(contour => contour.role)).toEqual(['exterior', 'counter']);
  const masters = project(source), heavy = inspectOpticalPaths(masters.find(master => master.weight === 600 && master.opsz === 24).paths)[0];
  expect(heavy.bounds).toEqual([0.8, 0.8, 23.2, 23.2]);
  expect(heavy.areas[1]).toBeCloseTo(13.6 ** 2, 6);
  const small = inspectOpticalPaths(masters.find(master => master.weight === 400 && master.opsz === 16).paths)[0];
  expect(small.areas[1]).toBeCloseTo(14.1 ** 2, 6);
  expect(() => compileOpticalGrid({ axes, source, masters })).not.toThrow();
});

it('preserves cubic closure and an exact coordinate center', () => {
  const source = [{ d: 'M2 12C2 2 22 2 22 12C22 22 2 22 2 12Z' }];
  const fields = draftOpticalFields(source)[0].contours[0].normal;
  expect(fields.slice(-2)).toEqual(fields.slice(0, 2));
  const compiled = compileOpticalGrid({ axes, source, masters: project(source) });
  expect(compiled.paths[0].commands).toBe('MCCZ');
  expect(inspectOpticalPaths(project(source)[8].paths)[0].crossings).toBe(0);
});

it('limits thin details locally and rejects corrupted field correspondence', () => {
  const source = [{ d: 'M2 2L2.001 2L2.001 3L2 3Z' }, { d: 'M5 5L19 5L19 19L5 19Z' }];
  const fields = draftOpticalFields(source);
  expect(fields[0].contours[0].offsetScale).toBeLessThan(0.01);
  expect(fields[1].contours[0].offsetScale).toBeUndefined();
  expect(() => compileOpticalGrid({ axes, source, masters: project(source) })).not.toThrow();
  fields[0].contours[0].normal.pop();
  expect(() => opticalRecipeMasters({ axes, source, recipes: [], fields, fieldProfile: profile })).toThrow('correspondence');
});

it('compiles optical changes for all 660 variants and refuses unreviewed production', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const corpus = compileOpticalCorpus(root, { preview: true });
  expect(Object.keys(corpus.symbols)).toHaveLength(330);
  for (const symbol of Object.values(corpus.symbols)) for (const variant of Object.values(symbol.data.variants)) {
    expect(variant.paths.some(path => path.terms.length > 0)).toBe(true);
  }
  expect(() => compileOpticalCorpus(root)).toThrow('still need visual review');
});
