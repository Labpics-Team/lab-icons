import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  declarationModuleSpecifiers,
  installedAllowlist,
  validatePackageProjection,
  validateReleaseContract,
  validateReleaseTypeDependencyGraph,
} from '../scripts/lib/release-contract.js';
import {
  validateDistProvenance,
  validateReleaseTag,
  validateSourceReleaseRef,
} from '../scripts/check-release-ref.js';
import { stageReleaseDist, validateReleaseFiles } from '../scripts/stage-release-dist.js';
import { symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';

const REPO_CONTRACT = JSON.parse(readFileSync(new URL('../release/contract.json', import.meta.url), 'utf8'));
const REPO_PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CONTRACT = symbolReleaseProjection(REPO_CONTRACT, ['fixture']);
const PACKAGE = { ...REPO_PACKAGE, files: CONTRACT.files, exports: CONTRACT.exports };
const roots = [];
const SOURCE_COMMIT = 'a'.repeat(40);
const DIST_COMMIT = 'b'.repeat(40);

const DECLARATIONS = Object.freeze({
  'dist/index.d.ts': 'export declare const accessibilityOutline: string;\n',
  'dist/ir/catalog.generated.d.ts': "export type CatalogIconId = 'fixture';\n",
  'dist/ir/author-catalog.generated.d.ts': "export type AuthorIconId = 'fixture';\n",
  'dist/ir/author-provenance.d.ts': "export interface AuthorSourceProvenance { readonly kind: 'figma' }\n",
  'dist/ir/author-source.d.ts': "import type { AuthorIconId } from './author-catalog.generated.js';\nimport type { GlyphIR } from './glyph-types.js';\nexport type { AuthorSourceProvenance } from './author-provenance.js';\nexport type AuthorSourceGlyph = GlyphIR & { readonly icon: AuthorIconId };\n",
  'dist/ir/index.d.ts':
    `import type { CatalogIconId } from './catalog.generated.js';\n` +
    `export type { RecipeResult } from './recipes.js';\n` +
    `export type { GlyphIR } from './compiler.js';\n` +
    'export declare const iconIds: readonly CatalogIconId[];\n',
  'dist/ir/compiler.d.ts': "import type { GlyphModelErrorCode } from './request.js';\nexport type { GlyphIR } from './glyph-types.js';\nexport interface GlyphCompiler { readonly code: GlyphModelErrorCode }\n",
  'dist/ir/glyph-types.d.ts': "import type { AuthorVariationProvenance } from './authored-variation.js';\nimport type { AuthorAnnulusVariationProvenance } from './author-annulus-types.js';\nimport type { AuthorContentVariationProvenance } from './author-content-types.js';\nimport type { AuthorCapsuleVariationProvenance } from './author-capsule-types.js';\nimport type { RecipeFillPaint } from './paint-types.js';\nexport interface GlyphIR { readonly paint: RecipeFillPaint; readonly variation?: AuthorVariationProvenance | AuthorAnnulusVariationProvenance | AuthorContentVariationProvenance | AuthorCapsuleVariationProvenance }\n",
  'dist/ir/paint-types.d.ts': "export interface RecipeFillPaint { readonly kind: 'fill' }\n",
  'dist/ir/authored-variation.d.ts': "export interface AuthorVariationProvenance { readonly kind: 'authored-variation' }\n",
  'dist/ir/author-annulus-types.d.ts': "import type { AuthorSourceProvenance } from './author-provenance.js';\nexport interface AuthorAnnulusVariationProvenance { readonly author: AuthorSourceProvenance }\n",
  'dist/ir/author-content-types.d.ts': "import type { AuthorSourceProvenance } from './author-provenance.js';\nexport interface AuthorContentVariationProvenance { readonly author: AuthorSourceProvenance }\n",
  'dist/ir/author-capsule-types.d.ts': "import type { AuthorSourceProvenance } from './author-provenance.js';\nexport interface AuthorCapsuleVariationProvenance { readonly author: AuthorSourceProvenance }\n",
  'dist/ir/request.d.ts': "export type GlyphModelErrorCode = 'CANDIDATES_REQUIRED';\n",
  'dist/ir/render.d.ts': "import type { GlyphIR } from './glyph-types.js';\nexport declare function renderGlyphSvg(glyph: GlyphIR): string;\n",
  'dist/authoring/index.d.ts': "export { compileDesignSpec } from './design-spec.js';\n",
  'dist/authoring/design-spec.d.ts': "import type { GlyphIR } from '../ir/glyph-types.js';\nexport declare function compileDesignSpec(spec: unknown): GlyphIR;\n",
  'dist/motion/index.d.ts': "import type { GlyphIR } from '../ir/index.js';\nimport type { StateRefusal } from '../ir/state-types.js';\nimport type { PreparedContourStateEffect } from '../ir/contour-state-types.js';\nexport declare function compileSymbolEffect(glyph: GlyphIR): StateRefusal | PreparedContourStateEffect;\n",
  'dist/ir/state-types.d.ts': "export type { StateRefusal } from './state-common-types.js';\n",
  'dist/ir/state-common-types.d.ts': "export interface StateRefusal { readonly ok: false }\n",
  'dist/ir/contour-state-types.d.ts': "import type { StateRefusal } from './state-common-types.js';\nexport type PreparedContourStateEffect = StateRefusal | { readonly ok: true };\n",
  'dist/symbols/fixture.d.ts': "import type { AuthorSourceGlyph } from '../ir/author-source.js';\nexport declare function glyph(): AuthorSourceGlyph;\n",
  'dist/lottie/fixture.d.ts': "import type { LottieExportResult } from '../ir/lottie-types.js';\nexport declare function exportLottie(): LottieExportResult;\n",
  'dist/ir/lottie-types.d.ts': "import type { GlyphIR } from './glyph-types.js';\nexport interface LottieExportResult { readonly glyph: GlyphIR }\n",
  'dist/ir/recipes.d.ts': "export type { RecipeFillPaint } from './paint-types.js';\nexport interface RecipeResult { readonly kind: string }\n",
  'dist/ir/candidates.d.ts': 'export declare function registerCandidates(): void;\n',
});

function write(root, path, content = '') {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function stagingRoot() {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-release-contract-'));
  roots.push(root);
  mkdirSync(join(root, 'release'), { recursive: true });
  writeFileSync(join(root, 'release/contract.json'), `${JSON.stringify(CONTRACT)}\n`, 'utf8');
  for (const file of CONTRACT.files) {
    const absolute = join(root, file);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, '', 'utf8');
  }
  return root;
}

function provenanceGit({
  parent = SOURCE_COMMIT,
  changed = CONTRACT.files,
  tracked = CONTRACT.files,
  driftFile = null,
  head = SOURCE_COMMIT,
} = {}) {
  return (_root, args) => {
    if (args[0] === 'rev-parse' && args[1] === '--verify') {
      if (args[2] === 'refs/tags/v0.2.0^{commit}') return SOURCE_COMMIT;
      if (args[2] === 'refs/tags/v0.2.0-dist^{commit}') return DIST_COMMIT;
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return head;
    if (args[0] === 'rev-list') return `${DIST_COMMIT} ${parent}`;
    if (args[0] === 'diff-tree') return `${changed.join('\n')}\n`;
    if (args[0] === 'ls-tree') return `${tracked.join('\n')}\n`;
    if (args[0] === 'hash-object') return `blob:${args.at(-1)}`;
    if (args[0] === 'rev-parse' && args[1].startsWith(`${DIST_COMMIT}:`)) {
      const file = args[1].slice(DIST_COMMIT.length + 1);
      return driftFile === file ? `drift:${file}` : `blob:${file}`;
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

function realGit(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('release contract', () => {
  it('отказывает declaration-only модулю под публичным wildcard', () => {
    for (const directory of ['symbols', 'lottie']) {
      const ghost = `dist/${directory}/private-types.d.ts`;
      const contract = { ...CONTRACT, files: [...CONTRACT.files, ghost].sort(),
        typeDependencies: [...CONTRACT.typeDependencies, ghost].sort() };
      expect(validateReleaseContract(contract)).toContain(`release ${directory} wildcard имеет types без runtime: ${ghost}`);
    }
  });
  it('является точным SSOT для npm projection и физических outputs', () => {
    expect(validateReleaseContract(REPO_CONTRACT)).toEqual([]);
    expect(validatePackageProjection(REPO_PACKAGE, REPO_CONTRACT)).toEqual([]);
    expect(validateReleaseContract(CONTRACT)).toEqual([]);
    expect(validatePackageProjection(PACKAGE, CONTRACT)).toEqual([]);
    expect(validateReleaseFiles(stagingRoot(), CONTRACT)).toEqual([]);
    expect(CONTRACT.files.every((file) => !file.endsWith('/') && !file.includes('*'))).toBe(true);
  });

  it('доказывает точную import closure публичных деклараций', () => {
    expect(
      validateReleaseTypeDependencyGraph({
        contract: CONTRACT,
        readText(file) {
          if (!Object.hasOwn(DECLARATIONS, file)) throw new Error('ENOENT');
          return DECLARATIONS[file];
        },
      }),
    ).toEqual([]);
  });

  it('lexer видит все module-reference формы, но не текст комментариев', () => {
    const parsed = declarationModuleSpecifiers(
      `// import './comment.js'\n` +
      `/* export type { Ghost } from './ghost.js' */\n` +
      `import './side-effect.js';\n` +
      `import type Main = require('./require.js');\n` +
      `export type Lazy = import('./lazy.js').Lazy;\n` +
      `export type { Direct } from './direct.js';\n`,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.specifiers).toEqual([
      './side-effect.js',
      './require.js',
      './lazy.js',
      './direct.js',
    ]);
  });

  it('fail-closed отклоняет external и escaped type dependency', () => {
    const external = {
      ...DECLARATIONS,
      'dist/ir/index.d.ts':
        `import type { External } from 'unlisted-package';\n` + DECLARATIONS['dist/ir/index.d.ts'],
    };
    const externalErrors = validateReleaseTypeDependencyGraph({
      contract: CONTRACT,
      readText(file) {
        return external[file];
      },
    });
    expect(externalErrors).toContain(
      'release declaration graph: dist/ir/index.d.ts содержит внешнюю type-зависимость unlisted-package',
    );

    expect(declarationModuleSpecifiers(`import './catalog\\u002egenerated.js';`).errors).toEqual([
      'escaped module specifier запрещён на offset 7',
    ]);
  });

  it('не позволяет manifest легализовать orphan typeDependency', () => {
    const orphan = 'dist/ir/orphan.d.ts';
    const contract = {
      ...CONTRACT,
      files: [...CONTRACT.files, orphan].sort(),
      typeDependencies: [...CONTRACT.typeDependencies, orphan].sort(),
    };
    const errors = validateReleaseTypeDependencyGraph({
      contract,
      readText(file) {
        if (!Object.hasOwn(DECLARATIONS, file)) throw new Error('ENOENT');
        return DECLARATIONS[file];
      },
    });
    expect(errors).toContain(
      `release typeDependencies не равен import closure: declared [${contract.typeDependencies.join(', ')}], actual [${CONTRACT.typeDependencies.join(', ')}]`,
    );
  });

  it('кусается на отсутствующей транзитивной декларации', () => {
    const contract = {
      ...CONTRACT,
      files: CONTRACT.files.filter((file) => file !== 'dist/ir/catalog.generated.d.ts'),
      typeDependencies: [],
    };
    const errors = validateReleaseTypeDependencyGraph({
      contract,
      readText(file) {
        if (!Object.hasOwn(DECLARATIONS, file)) throw new Error('ENOENT');
        return DECLARATIONS[file];
      },
    });
    expect(errors).toContain(
      'release declaration graph: dist/ir/index.d.ts импортирует отсутствующий dist/ir/catalog.generated.d.ts',
    );
  });

  it('не допускает directory entry, glob и sourcemap', () => {
    for (const file of ['dist/ir', 'dist/**/*.js', 'dist/ir/index.js.map']) {
      const bad = { ...CONTRACT, files: [...CONTRACT.files, file].sort() };
      expect(validateReleaseContract(bad).some((error) => error.includes(file))).toBe(true);
    }
  });

  it('fail-closed отклоняет unknown keys на каждом уровне публичной схемы', () => {
    const cases = [
      { ...CONTRACT, surprise: true },
      { ...CONTRACT, primary: { ...CONTRACT.primary, registry: 'shadow' } },
      { ...CONTRACT, fallback: { ...CONTRACT.fallback, mutable: true } },
      { ...CONTRACT, exports: { ...CONTRACT.exports, './private': { import: './dist/index.js' } } },
      {
        ...CONTRACT,
        exports: {
          ...CONTRACT.exports,
          './ir': { ...CONTRACT.exports['./ir'], browser: './dist/ir/index.js' },
        },
      },
    ];
    for (const bad of cases) expect(validateReleaseContract(bad).length).toBeGreaterThan(0);
  });

  it('запечатывает ESM type condition перед import и запрещает legacy animate surface', () => {
    const legacyAnimate = {
      ...CONTRACT,
      exports: {
        ...CONTRACT.exports,
        './animate': {
          import: './dist/animate/index.js',
        },
      },
    };
    expect(validateReleaseContract(legacyAnimate).some((error) => error.includes('./animate'))).toBe(true);

    const reordered = {
      ...CONTRACT,
      exports: {
        ...CONTRACT.exports,
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts',
        },
      },
    };
    expect(validateReleaseContract(reordered).some((error) => error.includes('опасный порядок conditions'))).toBe(true);
    expect(validatePackageProjection({ ...PACKAGE, exports: reordered.exports }, CONTRACT)).toContain(
      'package.json#exports дрейфует от release contract',
    );
  });

  it('не допускает ни одного файла manifest вне export surface', () => {
    const files = [...CONTRACT.files, 'dist/orphan.js'].sort();
    expect(validateReleaseContract({ ...CONTRACT, files })).toContain(
      'release file не достижим из export или dependency: dist/orphan.js',
    );
  });

  it('публичная npm-проекция запрещает private и не-SemVer version', () => {
    expect(validatePackageProjection({ ...PACKAGE, private: true }, CONTRACT)).toContain(
      'package.json#private обязан быть false для public npm channel',
    );
    expect(validatePackageProjection({ ...PACKAGE, version: '0.2' }, CONTRACT)).toContain(
      'package.json#version обязан быть строгим SemVer; найдено 0.2',
    );
  });

  it('installed allowlist закрыт и включает только npm metadata сверх manifest', () => {
    expect(installedAllowlist(CONTRACT)).toEqual([
      'LICENSE',
      'README.md',
      ...CONTRACT.files,
      'package.json',
    ].sort());
  });

  it('workflow staging делегирован manifest-aware скрипту без hardcoded git add', () => {
    const workflow = readFileSync(new URL('../.github/workflows/release-dist.yml', import.meta.url), 'utf8');
    expect(workflow).toMatch(/^\s*node scripts\/stage-release-dist\.js\s*$/m);
    expect(workflow).not.toMatch(/^\s*git add .*dist/m);
  });

  it('staging очищает tracked dist и передаёт git add точный manifest', () => {
    const calls = [];
    const runGit = (_root, args) => {
      calls.push(args);
      if (args[0] === 'ls-files') return `${CONTRACT.files.join('\n')}\n`;
      return '';
    };
    expect(stageReleaseDist({ root: stagingRoot(), runGit })).toEqual(CONTRACT.files);
    expect(calls).toContainEqual(['rm', '-r', '--cached', '--ignore-unmatch', '--', 'dist']);
    expect(calls).toContainEqual(['add', '-f', '--', ...CONTRACT.files]);
  });

  it('release source принимает только точный v<package.version> SemVer tag на HEAD', () => {
    expect(validateReleaseTag('v0.2.0', '0.2.0')).toEqual([]);
    expect(validateReleaseTag('master', '0.2.0')).toContain(
      'release ref обязан быть ровно v0.2.0; найдено master',
    );
    expect(validateReleaseTag('v01.2.0', '01.2.0')).toContain(
      'package.json#version не является строгим SemVer: 01.2.0',
    );
    expect(validateSourceReleaseRef({
      root: stagingRoot(),
      tag: 'v0.2.0',
      packageVersion: '0.2.0',
      runGit: provenanceGit({ head: 'c'.repeat(40) }),
    }).some((error) => error.includes('checkout HEAD'))).toBe(true);
  });

  it('existing/new -dist доказывает parent, exact tree и байты clean build', () => {
    const root = stagingRoot();
    expect(validateDistProvenance({
      root,
      tag: 'v0.2.0',
      packageVersion: '0.2.0',
      contract: CONTRACT,
      runGit: provenanceGit(),
    })).toEqual([]);

    const wrongParent = validateDistProvenance({
      root,
      tag: 'v0.2.0',
      packageVersion: '0.2.0',
      contract: CONTRACT,
      runGit: provenanceGit({ parent: 'c'.repeat(40) }),
    });
    expect(wrongParent.some((error) => error.includes('ожидается один parent'))).toBe(true);

    const byteDrift = validateDistProvenance({
      root,
      tag: 'v0.2.0',
      packageVersion: '0.2.0',
      contract: CONTRACT,
      runGit: provenanceGit({ driftFile: 'dist/ir/index.js' }),
    });
    expect(byteDrift).toContain(
      'v0.2.0-dist: dist/ir/index.js не совпадает с проверенной clean-сборкой',
    );
  });

  it('проверяет provenance на реальном source/dist commit graph', () => {
    const root = stagingRoot();
    rmSync(join(root, 'dist'), { recursive: true, force: true });
    realGit(root, ['init']);
    realGit(root, ['config', 'user.name', 'release-test']);
    realGit(root, ['config', 'user.email', 'release-test@example.invalid']);
    realGit(root, ['add', 'release/contract.json']);
    realGit(root, ['commit', '-m', 'source']);
    realGit(root, ['tag', 'v0.2.0']);

    for (const file of CONTRACT.files) write(root, file, `built:${file}\n`);
    realGit(root, ['add', '-f', '--', ...CONTRACT.files]);
    realGit(root, ['commit', '-m', 'dist']);
    realGit(root, ['tag', 'v0.2.0-dist']);

    expect(validateDistProvenance({
      root,
      tag: 'v0.2.0',
      packageVersion: '0.2.0',
      contract: CONTRACT,
      runGit: realGit,
    })).toEqual([]);

    write(root, 'dist/ir/index.js', 'hostile working-tree drift\n');
    expect(validateDistProvenance({
      root,
      tag: 'v0.2.0',
      packageVersion: '0.2.0',
      contract: CONTRACT,
      runGit: realGit,
    })).toContain('v0.2.0-dist: dist/ir/index.js не совпадает с проверенной clean-сборкой');
  });
});
