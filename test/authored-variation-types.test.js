import { expect, it } from 'vitest';
import { checkGlyphTypeBoundary } from '../scripts/bench/glyph-type-boundary.mjs';

it('public declarations preserve source, variation and augmentation without compiler closure', async () => {
  const report = await checkGlyphTypeBoundary();
  expect(report.findings).toEqual([]);
  for (const mode of ['Bundler', 'NodeNext']) {
    const consumer = report.observations.actual.consumers[mode];
    expect(consumer.positive.codes).toEqual([]);
    expect(consumer.negative.codes).toEqual([2322, 2322, 2345, 2339, 2345, 2345]);
    expect(consumer.augmentation.codes).toEqual([]);
    expect(consumer.augmentationNegative.codes).toEqual([2322, 2322, 2322, 2322]);
  }
  for (const entrypoint of ['source', 'variation']) {
    const files = report.observations.actual.closures[entrypoint].files;
    expect(files).toContain('ir/glyph-types.d.ts');
    expect(files).not.toContain('ir/compiler.d.ts');
    expect(files).not.toContain('ir/recipes.d.ts');
  }
});
