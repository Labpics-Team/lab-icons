import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle } from '../scripts/build-ir.mjs';
import { bundleScenario, parseConsumerSizeRatchet } from '../scripts/check-consumer-size.js';
import { authoredSymbolPayloads } from './helpers/authored-symbol-payload.js';
import { renderSymbolModules, variationRuntimeTargets } from '../scripts/lib/symbol-modules.js';
import { sourcePacketRuntimeTargets } from '../scripts/lib/source-packet.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const policy = parseConsumerSizeRatchet(JSON.parse(readFileSync(
  new URL('../release/consumer-size-ratchet.json', import.meta.url), 'utf8',
))).scenarios;
const cases = [
  ['source-ellipsis-horizontal', 'ellipsis-horizontal', 'symbols'],
  ['source-ellipsis-vertical', 'ellipsis-vertical', 'symbols'],
  ['varied-microphone-circle', 'mic-circle', 'variations'],
  ['gesture-reload-ir-reference', 'reload', 'symbols'],
  ['gesture-refresh-ir-reference', 'refresh', 'symbols'],
];
let consumer;

beforeAll(async () => {
  consumer = mkdtempSync(join(tmpdir(), 'lab-icons-shipping-consumer-'));
  const dist = join(consumer, 'dist');
  const emit = (path, text) => {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), text);
  };
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  const inputs = await authoredSymbolPayloads(cases.map(([, icon]) => icon));
  const outputs = Object.fromEntries(Object.entries(inputs).map(([icon, input]) => [icon, renderSymbolModules(input)]));
  for (const [icon, output] of Object.entries(outputs)) {
    emit(`symbols/${icon}.js`, output.symbol);
    if (output.data) emit(`ir/symbol-data/${icon}.js`, output.data);
  }
  emit('variations/mic-circle.js', outputs['mic-circle'].variation);

  // Production bundle владеет minify, target и provenance. Consumer получает
  // только emitted JS в чистом каталоге, без alias на TypeScript из workspace.
  const variation = variationRuntimeTargets([inputs['mic-circle'].variation.outline.law]);
  const targets = [
    ['src/ir/request.ts', 'ir/request.js', []],
    ['src/ir/author-request-runtime.ts', 'ir/author-request-runtime.js', ['./request.js']],
    ['src/ir/symbol-runtime.ts', 'ir/symbol-runtime.js', ['./request.js', './author-request-runtime.js']],
    ['src/ir/annulus-geometry-runtime.ts', 'ir/annulus-geometry-runtime.js', []],
    ['src/ir/contour-runtime.ts', 'ir/contour-runtime.js', []],
    ['src/ir/render.ts', 'ir/render.js', []],
    ['src/motion/index.ts', 'motion/index.js', ['../ir/contour-runtime.js']],
    ...variation.map(({ entry, runtime }) => [entry, `ir/${runtime}`,
      ['./request.js', './symbol-runtime.js', './author-request-runtime.js', './annulus-geometry-runtime.js']]),
    ...sourcePacketRuntimeTargets(Object.values(outputs)).map(({ entry, runtime }) => [entry, `ir/${runtime}`, []]),
  ];
  for (const [, target] of targets) mkdirSync(dirname(join(dist, target)), { recursive: true });
  const builds = await Promise.allSettled(targets.map(([entry, target, external]) => bundle(root, dist, entry, target, external)));
  for (const result of builds) if (result.status === 'rejected') throw result.reason;
});

afterAll(() => {
  if (consumer) rmSync(consumer, { recursive: true, force: true });
});

describe('замкнутый shipping import сохраняет прежний consumer budget', () => {
  it.each(cases)('%s: emitted symbol и production runtime помещаются в действующие raw/gzip ceilings', async (name, icon, entryKind) => {
    const limits = policy[name];
    const measured = await bundleScenario(limits.entry, { root: consumer });
    expect(measured.modules).toContain(`dist/${entryKind}/${icon}.js`);
    const retainedIcons = measured.modules.filter(path => /^dist\/(?:symbols|variations|ir\/symbol-data)\//.test(path))
      .map(path => path.split('/').at(-1).replace(/\.js$/, ''));
    expect([...new Set(retainedIcons)]).toEqual([icon]);
    expect(measured.bytes, `${name}: raw consumer closure`).toBeLessThanOrEqual(limits.maxBytes);
    expect(measured.gzipBytes, `${name}: gzip consumer closure`).toBeLessThanOrEqual(limits.maxGzipBytes);
  });
});
