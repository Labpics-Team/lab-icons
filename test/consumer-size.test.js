import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundleScenario,
  checkConsumerSize,
  CONSUMER_SIZE_MEASUREMENT,
  parseConsumerSizeRatchet,
} from '../scripts/check-consumer-size.js';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-consumer-size-'));
  roots.push(root);
  mkdirSync(join(root, 'dist/ir'), { recursive: true });
  mkdirSync(join(root, 'release'), { recursive: true });
  writeFileSync(
    join(root, 'dist/index.js'),
    `export const alertFilled = "<svg>alert</svg>";\n` +
      `export const unusedFilled = "UNUSED_SENTINEL_${'x'.repeat(2048)}";\n`,
  );
  const entry = "import { alertFilled } from '@labpics/icons';\nconsole.log(alertFilled);\n";
  const measured = await bundleScenario(entry, { root });
  writeFileSync(join(root, 'release/consumer-size-ratchet.json'), JSON.stringify({
    version: 1,
    measurement: CONSUMER_SIZE_MEASUREMENT,
    scenarios: {
      'one-static': {
        entry,
        baselineBytes: measured.bytes,
        baselineGzipBytes: measured.gzipBytes,
        maxBytes: measured.bytes,
        maxGzipBytes: measured.gzipBytes,
      },
    },
  }));
  return { root, entry, measured };
}

function updateRatchet(root, update) {
  const file = join(root, 'release/consumer-size-ratchet.json');
  const ratchet = JSON.parse(readFileSync(file, 'utf8'));
  update(ratchet);
  writeFileSync(file, JSON.stringify(ratchet));
}

describe('consumer size ratchet', () => {
  it('фиксирует consumer-бандл сценария и tree-shake неиспользуемого экспорта', async () => {
    const { root } = await fixture();
    const result = await checkConsumerSize({ root });
    expect(result.errors).toEqual([]);
    const bundled = await bundleScenario(
      "import { alertFilled } from '@labpics/icons';\nconsole.log(alertFilled);\n",
      { root },
    );
    // 2KB sentinel гарантирует: при сломанном tree-shake порог будет превышен.
    expect(bundled.bytes).toBeLessThan(200);
    const withoutImport = "console.log('@labpics/icons');";
    expect(() => parseConsumerSizeRatchet({
      version: 1,
      measurement: CONSUMER_SIZE_MEASUREMENT,
      scenarios: {
        fake: {
          entry: withoutImport,
          baselineBytes: 1,
          baselineGzipBytes: 1,
          maxBytes: 1,
          maxGzipBytes: 1,
        },
      },
    })).toThrow(/static import/);
  });

  it('кусается при дрейфе baseline в обе стороны и при превышении max', async () => {
    const grew = await fixture();
    writeFileSync(
      join(grew.root, 'dist/index.js'),
      'export const alertFilled = "<svg>alert-heavier-payload</svg>";\n',
    );
    const grewResult = await checkConsumerSize({ root: grew.root });
    expect(grewResult.errors.join('\n')).toMatch(/!= factual baselineBytes/);
    expect(grewResult.errors.join('\n')).toMatch(/B > ratchet/);

    const shrank = await fixture();
    writeFileSync(join(shrank.root, 'dist/index.js'), 'export const alertFilled = "x";\n');
    const shrankResult = await checkConsumerSize({ root: shrank.root });
    // уменьшение — тоже дрейф: baseline опускается коммитом, не молчанием
    expect(shrankResult.errors.join('\n')).toMatch(
      /!= factual baselineBytes|package import не внёс байтов/,
    );
  });

  it('fail-closed: невалидная форма ratchet — ошибка, не пропуск', async () => {
    const versionCase = await fixture();
    updateRatchet(versionCase.root, (ratchet) => { ratchet.version = 2; });
    expect((await checkConsumerSize({ root: versionCase.root })).errors.join('\n'))
      .toMatch(/version/);

    const measurementCase = await fixture();
    updateRatchet(measurementCase.root, (ratchet) => { ratchet.measurement = 'gzip approx'; });
    expect((await checkConsumerSize({ root: measurementCase.root })).errors.join('\n'))
      .toMatch(/measurement/);

    const ceilingCase = await fixture();
    updateRatchet(ceilingCase.root, (ratchet) => {
      ratchet.scenarios['one-static'].maxBytes =
        ratchet.scenarios['one-static'].baselineBytes - 1;
    });
    expect((await checkConsumerSize({ root: ceilingCase.root })).errors.join('\n'))
      .toMatch(/maxBytes.*baselineBytes/);
  });

  it('parse-граница отклоняет чужие ключи и не-@labpics entry', () => {
    const base = {
      version: 1,
      measurement: CONSUMER_SIZE_MEASUREMENT,
      scenarios: {
        ok: {
          entry: "import { x } from '@labpics/icons';",
          baselineBytes: 1,
          baselineGzipBytes: 1,
          maxBytes: 1,
          maxGzipBytes: 1,
        },
      },
    };
    expect(() => parseConsumerSizeRatchet({ ...base, surprise: true })).toThrow(/surprise/);
    expect(() => parseConsumerSizeRatchet({
      ...base,
      scenarios: { ok: { ...base.scenarios.ok, entry: "import x from 'lodash';" } },
    })).toThrow(/@labpics\/icons/);
    expect(() => parseConsumerSizeRatchet({
      ...base,
      scenarios: { 'Bad Name': base.scenarios.ok },
    })).toThrow(/имя сценария/);
  });
});
