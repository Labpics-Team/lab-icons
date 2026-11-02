import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { symbolModuleDeclaration, variationModuleDeclaration } from '../scripts/lib/symbol-modules.js';

const root = fileURLToPath(new URL('..', import.meta.url)), compiler = join(root, 'node_modules/typescript/bin/tsc');
it('packed declaration paths preserve admitted body variants and reject coordinates in Bundler and NodeNext', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'lab-icons-capsule-types-'));
  try {
    const pkg = join(consumer, 'node_modules/@labpics/icons'), out = join(pkg, 'dist');
    execFileSync(process.execPath, [compiler, '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--stripInternal',
      '--strict', '--noUncheckedIndexedAccess', '--isolatedModules', '--resolveJsonModule', '--skipLibCheck', '--lib', 'ES2022,DOM',
      '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--rootDir', join(root, 'src'), '--outDir', out,
      join(root, 'src/ir/author-capsule-types.ts')], {cwd:root,stdio:'pipe',windowsHide:true});
    for (const directory of ['symbols','variations']) mkdirSync(join(out,directory));
    for (const icon of ['mic','mic-circle']) {
      writeFileSync(join(out,'symbols',`${icon}.d.ts`),symbolModuleDeclaration(icon));
      writeFileSync(join(out,'variations',`${icon}.d.ts`),variationModuleDeclaration(icon,'capsule.width',['outline','filled']));
    }
    writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'@labpics/icons',type:'module',exports:{
      './symbols/*':{types:'./dist/symbols/*.d.ts'},'./variations/*':{types:'./dist/variations/*.d.ts'}}}));
    writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
    const positive = [
      "import {glyph as mic,glyphCapabilities as micCaps} from '@labpics/icons/variations/mic';",
      "import {glyph as circled,glyphCapabilities as circleCaps} from '@labpics/icons/variations/mic-circle';",
      "import {glyph as source} from '@labpics/icons/symbols/mic';",
      "const exact:'source'=mic().provenance.kind;",
      "const filled=mic({variant:'filled',variation:{bodyWidth:.9}});",
      "const outline:'outline'=circled({variation:{bodyWidth:.9}}).variant;",
      "const negative:'filled'=circled({variant:'filled',variation:{bodyWidth:.9}}).variant;",
      "const negativeLaw:'capsule.width'=circleCaps('filled').variation.law;",
      "const law:'capsule.width'=micCaps('filled').variation.law;",
      "const domain:'bounded-capsule-width'=circleCaps().variation.domain.kind;",
      "declare const variant:'outline'|'filled'; const capability=circleCaps(variant);",
      "if(capability.variant==='outline'){const law:'capsule.width'=capability.variation.law;}",
      '// @ts-expect-error: другая variation law не принимается.',
      "mic({variation:{dotScale:.9}});",
      '// @ts-expect-error: ordinary import не принимает opt-in body geometry.',
      "source({variation:{bodyWidth:.9}});",
      '// @ts-expect-error: coordinate overrides остаются у compiler.',
      "mic({variation:{center:[12,12]}});",
      '// @ts-expect-error: изменение ширины не объявляется exact authored source.',
      "const fake:'source'=mic({variation:{bodyWidth:.9}}).provenance.kind;",
      'void[exact,filled,outline,negative,negativeLaw,law,domain,capability];',
    ].join('\n');
    const negative = positive.replace(/^\/\/ @ts-expect-error:.*\n/gm,'');
    const diagnostics = (source,mode) => {
      writeFileSync(join(consumer,'consumer.ts'),source);
      writeFileSync(join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,skipLibCheck:false,
        target:'ES2022',module:mode==='Bundler'?'ESNext':'NodeNext',moduleResolution:mode},files:['consumer.ts']}));
      try {execFileSync(process.execPath,[compiler,'-p',join(consumer,'tsconfig.json')],{cwd:consumer,stdio:'pipe',windowsHide:true});return '';}
      catch(error){if(error.status!==1&&error.status!==2)throw error;return String(error.stdout)+String(error.stderr);}
    };
    for (const mode of ['Bundler','NodeNext']) {
      expect(diagnostics(positive,mode),mode).toBe('');
      expect([...diagnostics(negative,mode).matchAll(/error TS(\d+):/g)].map(match=>Number(match[1])))
        .toEqual([2769,2322,2769,2322]);
    }
  } finally {
    // В fixture нет junction/symlink; удаляется только собственный абсолютный tmp.
    if (resolve(consumer).startsWith(resolve(tmpdir()) + '/')) rmSync(consumer,{recursive:true,force:true});
    else if (resolve(consumer).startsWith(resolve(tmpdir()) + '\\')) rmSync(consumer,{recursive:true,force:true});
  }
});
