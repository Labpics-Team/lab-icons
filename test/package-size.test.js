import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPackageSize, measureArtifact } from '../scripts/check-package-size.js';

const roots = [];
const MEASUREMENT = 'node:zlib gzipSync level=9 mtime=0 after pnpm build';

const REQUIRED_LIMIT_FIELDS = [
  'baselineBytes',
  'baselineGzipBytes',
  'maxBytes',
  'maxGzipBytes',
  'allowedModules',
  'forbiddenNeedles',
];

function updateRatchet(root, update) {
  const file = join(root, 'release/package-size-ratchet.json');
  const ratchet = JSON.parse(readFileSync(file, 'utf8'));
  update(ratchet);
  writeFileSync(file, JSON.stringify(ratchet));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-size-ratchet-'));
  roots.push(root);
  const file = 'dist/ir/recipes.js';
  const source = Buffer.from('// scripts/lib/kernel.js\nexport const value = 1;\n');
  const measurement = measureArtifact(source);
  mkdirSync(join(root, 'release'), { recursive: true });
  mkdirSync(join(root, 'dist/ir'), { recursive: true });
  writeFileSync(join(root, file), source);
  writeFileSync(join(root, 'release/contract.json'), JSON.stringify({ files: [file] }));
  writeFileSync(join(root, 'release/package-size-ratchet.json'), JSON.stringify({
    version: 1,
    measurement: MEASUREMENT,
    artifacts: {
      [file]: {
        baselineBytes: measurement.bytes,
        baselineGzipBytes: measurement.gzipBytes,
        maxBytes: measurement.bytes,
        maxGzipBytes: measurement.gzipBytes,
        allowedModules: ['scripts/lib/kernel.js'],
        forbiddenNeedles: ['@labpics/icons'],
      },
    },
  }));
  return { root, file, source, measurement };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('package size ratchet', () => {
  it('фиксирует измеренный размер и закрытый import graph лёгкого recipes entry', () => {
    const { root, file } = fixture();
    const result = checkPackageSize({ root });
    expect(result.errors).toEqual([]);
    expect(result.measurements[file].modules).toEqual(['scripts/lib/kernel.js']);
  });

  it('измеряет byte/gzip факт без округления', () => {
    const { source } = fixture();
    const measurement = measureArtifact(source);
    expect(measurement.bytes).toBe(source.byteLength);
    expect(measurement.gzipBytes).toBeGreaterThan(0);
  });

  it.each(['version', 'measurement', 'artifacts'])(
    'fail-closed отклоняет удаление обязательного root-поля %s',
    (field) => {
      const { root } = fixture();
      updateRatchet(root, (ratchet) => delete ratchet[field]);

      expect(checkPackageSize({ root }).errors.join('\n')).toMatch(field);
    },
  );

  it.each(REQUIRED_LIMIT_FIELDS)(
    'fail-closed отклоняет удаление обязательного artifact-поля %s',
    (field) => {
      const { root, file } = fixture();
      updateRatchet(root, (ratchet) => delete ratchet.artifacts[file][field]);

      expect(checkPackageSize({ root }).errors.join('\n')).toMatch(field);
    },
  );

  it.each([
    ['baselineBytes', -1],
    ['baselineGzipBytes', 1.5],
    ['maxBytes', '1024'],
    ['maxGzipBytes', null],
    ['allowedModules', ['../private.js']],
    ['forbiddenNeedles', ['']],
  ])('fail-closed отклоняет невалидное artifact-поле %s', (field, value) => {
    const { root, file } = fixture();
    updateRatchet(root, (ratchet) => {
      ratchet.artifacts[file][field] = value;
    });

    expect(checkPackageSize({ root }).errors.join('\n')).toMatch(field);
  });

  it('fail-closed отклоняет неизвестные root/artifact ключи', () => {
    const rootCase = fixture();
    updateRatchet(rootCase.root, (ratchet) => {
      ratchet.surprise = true;
    });
    expect(checkPackageSize({ root: rootCase.root }).errors.join('\n')).toMatch(/surprise/);

    const artifactCase = fixture();
    updateRatchet(artifactCase.root, (ratchet) => {
      ratchet.artifacts[artifactCase.file].tolerance = 1;
    });
    expect(checkPackageSize({ root: artifactCase.root }).errors.join('\n')).toMatch(/tolerance/);
  });

  it.each([
    ['version', 2],
    ['artifacts', []],
  ])('fail-closed отклоняет невалидное root-поле %s', (field, value) => {
    const { root } = fixture();
    updateRatchet(root, (ratchet) => {
      ratchet[field] = value;
    });

    expect(checkPackageSize({ root }).errors.join('\n')).toMatch(field);
  });

  it('fail-closed проверяет optional identicalTo как ссылку на ratcheted dist-файл', () => {
    const unsafeCase = fixture();
    updateRatchet(unsafeCase.root, (ratchet) => {
      ratchet.artifacts[unsafeCase.file].identicalTo = '../outside.d.ts';
    });
    expect(checkPackageSize({ root: unsafeCase.root }).errors.join('\n')).toMatch(/identicalTo/);

    const missingCase = fixture();
    updateRatchet(missingCase.root, (ratchet) => {
      ratchet.artifacts[missingCase.file].identicalTo = 'dist/ir/missing.d.ts';
    });
    expect(checkPackageSize({ root: missingCase.root }).errors.join('\n')).toMatch(
      /identicalTo отсутствует в artifacts/,
    );
  });

  it('fail-closed отклоняет ложную measurement biography и ceiling ниже baseline', () => {
    const measurementCase = fixture();
    updateRatchet(measurementCase.root, (ratchet) => {
      ratchet.measurement = 'gzip approximately';
    });
    expect(checkPackageSize({ root: measurementCase.root }).errors.join('\n')).toMatch(/measurement/);

    const ceilingCase = fixture();
    updateRatchet(ceilingCase.root, (ratchet) => {
      ratchet.artifacts[ceilingCase.file].maxBytes =
        ratchet.artifacts[ceilingCase.file].baselineBytes - 1;
    });
    expect(checkPackageSize({ root: ceilingCase.root }).errors.join('\n')).toMatch(
      /maxBytes.*baselineBytes/,
    );
  });

  it('baselineBytes/baselineGzipBytes являются точным factual snapshot', () => {
    const rawCase = fixture();
    updateRatchet(rawCase.root, (ratchet) => {
      ratchet.artifacts[rawCase.file].baselineBytes -= 1;
    });
    expect(checkPackageSize({ root: rawCase.root }).errors).toContain(
      `${rawCase.file}: ${rawCase.measurement.bytes} B != factual baselineBytes ` +
        `${rawCase.measurement.bytes - 1} B`,
    );

    const gzipCase = fixture();
    updateRatchet(gzipCase.root, (ratchet) => {
      ratchet.artifacts[gzipCase.file].baselineGzipBytes -= 1;
    });
    expect(checkPackageSize({ root: gzipCase.root }).errors).toContain(
      `${gzipCase.file}: ${gzipCase.measurement.gzipBytes} B gzip != factual baselineGzipBytes ` +
        `${gzipCase.measurement.gzipBytes - 1} B gzip`,
    );
  });

  it('размерные ceilings и forbidden needles действительно кусаются', () => {
    const rawCase = fixture();
    updateRatchet(rawCase.root, (ratchet) => {
      ratchet.artifacts[rawCase.file].baselineBytes -= 1;
      ratchet.artifacts[rawCase.file].maxBytes -= 1;
    });
    expect(checkPackageSize({ root: rawCase.root }).errors.join('\n')).toMatch(/B > ratchet/);

    const gzipCase = fixture();
    updateRatchet(gzipCase.root, (ratchet) => {
      ratchet.artifacts[gzipCase.file].baselineGzipBytes -= 1;
      ratchet.artifacts[gzipCase.file].maxGzipBytes -= 1;
    });
    expect(checkPackageSize({ root: gzipCase.root }).errors.join('\n')).toMatch(/B gzip > ratchet/);

    const needleCase = fixture();
    updateRatchet(needleCase.root, (ratchet) => {
      ratchet.artifacts[needleCase.file].forbiddenNeedles = ['export const'];
    });
    expect(checkPackageSize({ root: needleCase.root }).errors.join('\n')).toMatch(
      /запрещённый marker export const/,
    );
  });

  it('считает import graph множеством, а не раскладкой sections bundler-а', () => {
    const source = Buffer.from(
      '// src/ir/index.ts\nexport const first = 1;\n' +
      '// src/ir/index.ts\nexport const second = 2;\n',
    );

    expect(measureArtifact(source).modules).toEqual(['src/ir/index.ts']);
  });

  it('кусается, если CommonJS declaration перестала совпадать с ESM API', () => {
    const { root, file, source } = fixture();
    const twin = 'dist/ir/recipes.d.ts';
    mkdirSync(join(root, 'dist/ir'), { recursive: true });
    writeFileSync(join(root, twin), source);
    const ratchetFile = join(root, 'release/package-size-ratchet.json');
    const ratchet = JSON.parse(readFileSync(ratchetFile, 'utf8'));
    const contractFile = join(root, 'release/contract.json');
    const contract = JSON.parse(readFileSync(contractFile, 'utf8'));
    contract.files = [...contract.files, twin].sort();
    ratchet.artifacts[twin] = { ...ratchet.artifacts[file] };
    ratchet.artifacts[file].identicalTo = twin;
    writeFileSync(contractFile, JSON.stringify(contract));
    writeFileSync(ratchetFile, JSON.stringify(ratchet));
    expect(checkPackageSize({ root }).errors).toEqual([]);

    writeFileSync(join(root, twin), 'export declare const drift: true;\n');
    expect(checkPackageSize({ root }).errors).toContain(
      `${file}: обязан быть byte-identical ${twin}`,
    );
  });

  it('не оставляет новый release-файл вне size ratchet', () => {
    const { root } = fixture();
    const extra = 'dist/ir/index.js';
    writeFileSync(join(root, extra), 'export const unbounded = true;\n');
    writeFileSync(
      join(root, 'release/contract.json'),
      JSON.stringify({ files: ['dist/ir/recipes.js', extra] }),
    );

    expect(checkPackageSize({ root }).errors).toContain(
      'package size ratchet обязан покрывать exact release files: ' +
      'release=[dist/ir/index.js, dist/ir/recipes.js], ratchet=[dist/ir/recipes.js]',
    );
  });
});
