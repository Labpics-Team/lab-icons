import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { stateGroupDeclaration } from '../scripts/lib/author-state-groups.js';
import { stateVariationDeclaration } from '../scripts/lib/author-state-variations.js';

const root = fileURLToPath(new URL('..', import.meta.url)), compiler = join(root, 'node_modules/typescript/bin/tsc');
const states = JSON.parse(readFileSync(join(root, 'semantics/author-state-groups.json'), 'utf8'));

it('real public declarations preserve state types and refuse Filled, foreign axes and mutable patches in both resolutions', () => {
  const consumer = mkdtempSync(join(root, '.state-annulus-types-'));
  try {
    const pkg = join(consumer, 'node_modules/@labpics/icons'), out = join(pkg, 'dist');
    execFileSync(process.execPath, [compiler, '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--stripInternal',
      '--strict', '--noUncheckedIndexedAccess', '--isolatedModules', '--resolveJsonModule', '--skipLibCheck', '--lib', 'ES2022,DOM',
      '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--rootDir', join(root, 'src'), '--outDir', out,
      join(root, 'src/states/annulus-types.ts'), join(root, 'src/states/types.ts')], { cwd: root, stdio: 'pipe', windowsHide: true });
    mkdirSync(join(out, 'state-variations'));
    copyFileSync(join(out, 'states/annulus-types.d.ts'), join(out, 'ir/state-annulus-types.d.ts'));
    copyFileSync(join(out, 'states/common-types.d.ts'), join(out, 'ir/state-common-types.d.ts'));
    writeFileSync(join(out, 'ir/state-types.d.ts'), readFileSync(join(out, 'states/types.d.ts'), 'utf8').replaceAll('./common-types.js', './state-common-types.js'));
    for (const name of ['status-circle', 'playback-circle']) {
      writeFileSync(join(out, `states/${name}.d.ts`), stateGroupDeclaration(states, name));
      writeFileSync(join(out, `state-variations/${name}.d.ts`), stateVariationDeclaration(states, name));
    }
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: {
      './states/*': { types: './dist/states/*.d.ts' }, './state-variations/*': { types: './dist/state-variations/*.d.ts' } } }));
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const positive = [
      "import * as status from '@labpics/icons/state-variations/status-circle';",
      "import * as playback from '@labpics/icons/state-variations/playback-circle';",
      "import { renderStateSvg as sourceMount } from '@labpics/icons/states/status-circle';",
      "declare module '@labpics/icons/state-variations/status-circle' { namespace renderEnclosurePatch { let cached: string; } }",
      "status.renderEnclosurePatch.cached = 'consumer namespace';",
      "const initial = status.renderStateSvg('confirmation');",
      "const patch = status.renderEnclosurePatch({variant:'outline',variation:{enclosureEmphasis:1.1}});",
      "const motion = status.compileStateEffect('dismissal',{duration:200,reducedMotion:true});",
      "const otherMotion = playback.compileStateEffect('pause',{duration:200});",
      "const state: status.State = 'increase'; const otherState: playback.State = 'play';",
      "const typedState: status.State = status.enclosureVariationCapabilities().proof.members[0]!.state;",
      "const law: 'annulus.counter-scale' = status.enclosureVariationCapabilities().law;",
      "const exclusiveMaximum: false = status.enclosureVariationCapabilities().domain.scale.maximumInclusive;",
      "if(patch.ok){const contract:'labpics.symbol-geometry-patch/1'=patch.patch.contract;const d:string=patch.patch.attributes.d;void[contract,d];}",
      "if(!patch.ok){const code:'INVALID_REQUEST'|'VARIANT_UNSUPPORTED'|'VARIATION_OUTSIDE_DOMAIN'|'POSE_UNREPRESENTABLE'=patch.reason.code;void code;}",
      '// @ts-expect-error: независимая Filled форма не допускается.',
      "status.renderEnclosurePatch({variant:'filled',variation:{enclosureEmphasis:1.1}});",
      '// @ts-expect-error: параметр чужого закона.',
      "status.renderEnclosurePatch({variation:{dotScale:1.1}});",
      '// @ts-expect-error: это не произвольная ось веса.',
      "status.renderEnclosurePatch({variation:{weight:1.1}});",
      '// @ts-expect-error: состояние другой группы.',
      "status.compileStateEffect('play',{duration:200});",
      '// @ts-expect-error: состояние другой группы.',
      "playback.compileStateEffect('confirmation',{duration:200});",
      '// @ts-expect-error: geometry patch immutable.',
      "if(patch.ok)patch.patch.attributes.d='changed';",
      '// @ts-expect-error: capability immutable.',
      "status.enclosureVariationCapabilities().domain.scale.minimum=0;",
      '// @ts-expect-error: обычный state renderer остаётся source-only.',
      "sourceMount('confirmation',{variation:{enclosureEmphasis:1.1}});",
      'void[initial,motion,otherMotion,state,otherState,typedState,law,exclusiveMaximum];',
    ].join('\n');
    const negative = positive.replace(/^\/\/ @ts-expect-error:.*\n/gm, '');
    const diagnostics = (source, mode) => {
      writeFileSync(join(consumer, 'consumer.ts'), source);
      writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: false,
        target: 'ES2022', module: mode === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: mode }, files: ['consumer.ts'] }));
      try { execFileSync(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], { cwd: consumer, stdio: 'pipe', windowsHide: true }); return ''; }
      catch (error) { if (error.status !== 1 && error.status !== 2) throw error; return String(error.stdout) + String(error.stderr); }
    };
    for (const mode of ['Bundler', 'NodeNext']) {
      expect(diagnostics(positive, mode), mode).toBe('');
      expect([...diagnostics(negative, mode).matchAll(/error TS\d+:/g)]).toHaveLength(8);
    }
  } finally {
    if (!resolve(consumer).startsWith(resolve(root) + '\\') && !resolve(consumer).startsWith(resolve(root) + '/')) throw new Error('cleanup вне owned worktree');
    rmSync(consumer, { recursive: true, force: true });
  }
});
