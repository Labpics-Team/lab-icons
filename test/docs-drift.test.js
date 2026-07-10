import { describe, it, expect } from 'vitest';
import {
  ROOT,
  extractVersionRefs,
  extractCountClaims,
  computeCorpusFacts,
  allowedCounts,
  handoffViolations,
  findInkHexClaims,
  hasDocRole,
  distributionViolations,
  auditRepo,
} from '../scripts/check-docs-drift.js';

describe('версии: пины и примеры тегов', () => {
  it('ловит конкретный dist-пин и пример тега', () => {
    const refs = extractVersionRefs(
      'пин github:x/y#v0.0.1-dist и процесс `git tag v0.0.2 && git push`',
    );
    expect(refs).toEqual([
      { kind: 'dist-pin', version: '0.0.1' },
      { kind: 'tag-example', version: '0.0.2' },
    ]);
  });

  it('плейсхолдеры vX.Y.Z не считаются версией', () => {
    expect(extractVersionRefs('тег `vX.Y.Z-dist`, `git tag vX.Y.Z`')).toEqual([]);
  });
});

describe('счётчики корпуса', () => {
  it('извлекает утверждения с единицами корпуса', () => {
    const claims = extractCountClaims('222 имени × 2 = 444 SVG и 444 экспорта');
    expect(claims.map((c) => c.n)).toEqual([222, 444, 444]);
  });

  it('игнорирует числа без единиц и субвыборки', () => {
    // «28 из 222 иконок»: 28 — субвыборка без единицы, ловится только 222
    const claims = extractCountClaims('28 из 222 иконок — чистые композиции');
    expect(claims.map((c) => c.n)).toEqual([222]);
  });

  it('факты ФС согласованы между собой', () => {
    const f = computeCorpusFacts(ROOT);
    expect(f.total).toBe(f.outline + f.filled);
    expect(f.exports).toBe(f.names * 2);
    expect(f.outline).toBe(f.names);
  });

  it('кусается: устаревший счётчик не входит в допустимое множество', () => {
    const allowed = allowedCounts(computeCorpusFacts(ROOT));
    expect(allowed.has(447)).toBe(false);
    expect(allowed.has(200)).toBe(false);
  });
});

describe('хендоффы', () => {
  it('кусается: *-HANDOFF.md в корне запрещён', () => {
    const errs = handoffViolations({
      rootFiles: ['README.md', 'WAVE7-HANDOFF.md'],
      handoffs: {},
    });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/WAVE7-HANDOFF\.md/);
  });

  it('кусается: хендофф без строки «Статус:»', () => {
    const errs = handoffViolations({
      rootFiles: [],
      handoffs: { 'W9.md': '# W9\nделаем то-сё' },
    });
    expect(errs).toHaveLength(1);
  });

  it('пропускает хендофф в handoffs/ со статусом', () => {
    const errs = handoffViolations({
      rootFiles: ['README.md'],
      handoffs: { 'W7.md': '# W7\n\nСтатус: выполнено (PR #19).' },
    });
    expect(errs).toEqual([]);
  });
});

describe('чернила', () => {
  it('кусается: обещание конкретного hex чернил', () => {
    expect(findInkHexClaims('Filled — моно-чернила #101012')).toHaveLength(1);
  });

  it('пропускает честную формулировку наследования', () => {
    expect(
      findInkHexClaims('чернила наследуются от контекста (currentColor)'),
    ).toEqual([]);
  });
});

describe('роли доков', () => {
  it('принимает роль в заголовке или строке «Роль:»', () => {
    expect(hasDocRole('# Анатомия — справка\n')).toBe(true);
    expect(hasDocRole('# Модель — ADR\n\nСтатус: принят')).toBe(true);
    expect(hasDocRole('# Грамматика\n\nРоль: справка.\n')).toBe(true);
  });

  it('кусается: док без роли', () => {
    expect(hasDocRole('# Просто заметки\n\nтекст без роли где-то дальше')).toBe(false);
  });
});

describe('каналы поставки', () => {
  const contract = {
    version: 1,
    packageName: '@labpics/icons',
    primary: { kind: 'npm', install: 'pnpm add @labpics/icons' },
    fallback: {
      kind: 'github-dist-tag',
      specifier: 'github:Labpics-Team/lab-icons#vX.Y.Z-dist',
      immutable: true,
    },
    files: ['dist/index.js', 'dist/index.d.ts', 'dist/animate'],
    exports: {
      '.': { import: './dist/index.js', types: './dist/index.d.ts' },
      './animate': {
        types: './dist/animate/index.d.ts',
        import: './dist/animate/index.js',
        require: './dist/animate/index.cjs',
      },
    },
  };
  const pkg = {
    name: '@labpics/icons',
    private: false,
    files: contract.files,
    exports: contract.exports,
  };
  const workflow =
    'pnpm verify\ngit add -f dist/index.js dist/index.d.ts dist/animate';

  it('принимает npm primary и immutable git fallback', () => {
    const readme =
      'Основной канал — npm: `pnpm add @labpics/icons`.\n' +
      'Дополнительный fallback: `github:Labpics-Team/lab-icons#vX.Y.Z-dist`.';
    expect(
      distributionViolations({ readme, pkg, contract, releaseWorkflow: workflow }),
    ).toEqual([]);
  });

  it('кусается на старой private/git-only/PAT прозе', () => {
    const readme =
      'Пакет НЕ публикуется в npm (`private: true`), репозиторий приватный; ' +
      'нужен fine-grained PAT и GH_PAT.';
    const errors = distributionViolations({
      readme,
      pkg,
      contract,
      releaseWorkflow: workflow,
    });
    expect(errors.join('\n')).toMatch(/не содержит primary install/);
    expect(errors.join('\n')).toMatch(/private:false/);
    expect(errors.join('\n')).toMatch(/npm — основной/);
    expect(errors.join('\n')).toMatch(/репозиторий public/);
    expect(errors.join('\n')).toMatch(/не требует GitHub PAT/);
  });

  it('кусается на дрейфе package files/exports и workflow', () => {
    const readme =
      'Основной канал — npm: `pnpm add @labpics/icons`.\n' +
      'Дополнительный fallback: `github:Labpics-Team/lab-icons#vX.Y.Z-dist`.';
    const errors = distributionViolations({
      readme,
      pkg: { ...pkg, files: ['dist/index.js'], exports: {} },
      contract,
      releaseWorkflow: 'pnpm verify',
    });
    expect(errors).toContain('release contract files != package.json#files');
    expect(errors).toContain('release contract exports != package.json#exports');
    expect(errors.some((error) => error.includes('dist/animate'))).toBe(true);
  });
});

describe('интеграция: репозиторий чист', () => {
  it('auditRepo(ROOT) — ноль расхождений доков с реальностью', () => {
    const { errors } = auditRepo(ROOT);
    expect(errors).toEqual([]);
  });
});
