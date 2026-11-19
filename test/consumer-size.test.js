import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundleScenario,
  checkClockConsumerSizeCoverage,
  checkConsumerSize,
  clockConsumerEntries,
  CONSUMER_SIZE_MEASUREMENT,
  parseConsumerSizeRatchet,
} from '../scripts/check-consumer-size.js';
import { authorMotionTargets } from '../scripts/lib/author-motion-targets.js';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-consumer-size-'));
  roots.push(root);
  mkdirSync(join(root, 'dist/ir'), { recursive: true });
  mkdirSync(join(root, 'release'), { recursive: true });
  mkdirSync(join(root, 'semantics'), { recursive: true });
  writeFileSync(join(root, 'semantics/author-anatomy.json'), JSON.stringify({ icons: {} }));
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
  it('clock coverage покрывает все объявленные author targets до bundling', () => {
    const anatomy = JSON.parse(readFileSync(new URL('../semantics/author-anatomy.json', import.meta.url), 'utf8'));
    const ratchet = parseConsumerSizeRatchet(
      JSON.parse(readFileSync(new URL('../release/consumer-size-ratchet.json', import.meta.url), 'utf8')),
    );
    expect(checkClockConsumerSizeCoverage(ratchet, authorMotionTargets(anatomy).clocks)).toEqual([]);
  });

  it('clock coverage обнаруживает новый author target и подмену entry статическим import', () => {
    const clocks = authorMotionTargets({ icons: { future: { outline: { joint: { law: 'joint.authored-elbow' } } } } }).clocks;
    const entries = clockConsumerEntries(clocks);
    const scenarios = Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, { entry }]));
    expect(checkClockConsumerSizeCoverage({ scenarios }, clocks)).toEqual([]);
    expect(checkClockConsumerSizeCoverage({ scenarios: {} }, clocks)).toHaveLength(3);
    scenarios['gesture-future-prepared'].entry = "import { outline } from '@labpics/icons/symbols/future';\nconsole.log(outline);\n";
    expect(checkClockConsumerSizeCoverage({ scenarios }, clocks)).toEqual([
      'gesture-future-prepared: entry не совпадает с clock consumer',
    ]);
  });

  it('clock coverage не требует clock сценарии для пустого author cohort', () => {
    expect(checkClockConsumerSizeCoverage({ scenarios: {} }, authorMotionTargets({ icons: {} }).clocks)).toEqual([]);
  });

  it('clock coverage останавливает действующий checker до bundling при пропущенном target', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lab-icons-clock-coverage-'));
    roots.push(root);
    mkdirSync(join(root, 'release'), { recursive: true });
    mkdirSync(join(root, 'semantics'), { recursive: true });
    writeFileSync(join(root, 'semantics/author-anatomy.json'), JSON.stringify({
      icons: { future: { outline: { joint: { law: 'joint.authored-elbow' } } } },
    }));
    writeFileSync(join(root, 'release/consumer-size-ratchet.json'), JSON.stringify({
      version: 1,
      measurement: CONSUMER_SIZE_MEASUREMENT,
      scenarios: { static: {
        entry: "import { alertFilled } from '@labpics/icons';\nconsole.log(alertFilled);\n",
        baselineBytes: 1, baselineGzipBytes: 1, maxBytes: 1, maxGzipBytes: 1,
      } },
    }));
    // dist отсутствует: пропуск preflight даст bundle-error вместо причины отказа.
    const result = await checkConsumerSize({ root });
    expect(result.errors).toHaveLength(3);
    expect(result.errors.every(error => error.includes('clock consumer отсутствует'))).toBe(true);
    expect(result.measurements).toEqual({});
  });

  it.each([
    ['lottie/time', 'dist/lottie/time.js'],
    ['authoring', 'dist/authoring/index.js'],
    ['ir/candidates', 'dist/ir/candidates.js'],
  ])('измеряет опубликованный ESM entry %s по exports', async (subpath, target) => {
    const { root } = await fixture();
    mkdirSync(join(root, target, '..'), { recursive: true });
    writeFileSync(join(root, target), 'export const payload = "PUBLIC_ENTRY_CONTROL";\n');
    const measured = await bundleScenario(
      `import { payload } from '@labpics/icons/${subpath}';\nconsole.log(payload);\n`,
      { root },
    );
    expect(measured.bytes).toBeGreaterThan(0);
    expect(measured.modules).toContain(target);
    expect(measured.modules).not.toContain(target.replace(/\.js$/, '.d.ts'));
  });

  it.each(['private/time', 'lottie/', 'lottie/../time', 'lottie/time/extra'])(
    'отказывает непубличному или невалидному subpath %s', async subpath => {
      const { root } = await fixture();
      await expect(bundleScenario(
        `import { payload } from '@labpics/icons/${subpath}';\nconsole.log(payload);\n`,
        { root },
      )).rejects.toThrow(/неизвестный package subpath/);
    },
  );

  it('измеряет публичный state entry и отказывает удалённому contribution', async () => {
    const { root } = await fixture();
    mkdirSync(join(root, 'dist/states'), { recursive: true });
    writeFileSync(join(root, 'dist/states/status-circle.js'),
      'export const renderStateSvg = state => ({ svg: "<svg>" + state + "</svg>" });\n' +
      'export const compileStateEffect = state => ({ effect: { targetState: state } });\n' +
      `export const unused = "UNUSED_STATE_SENTINEL_${'x'.repeat(2048)}";\n`);
    const entry = "import { renderStateSvg, compileStateEffect } from '@labpics/icons/states/status-circle';\n" +
      "console.log(renderStateSvg('question'), compileStateEffect('confirmation', { duration: 180 }));\n";
    const measured = await bundleScenario(entry, { root, includeBrotli: true });
    expect(measured.bytes).toBeGreaterThan(0);
    expect(measured.brotliBytes).toBeGreaterThan(0);
    expect(measured.bytes).toBeLessThan(500);
    expect(measured.modules).toContain('dist/states/status-circle.js');
    await expect(bundleScenario(
      "import { renderStateSvg } from '@labpics/icons/states/status-circle';\nconsole.log('unused');\n", { root },
    )).rejects.toThrow(/не внёс байтов/);
  });

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
