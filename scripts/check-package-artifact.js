#!/usr/bin/env node
/**
 * Проверка реального package artifact, а не рабочего дерева.
 *
 * Сборка может быть зелёной, а опубликованный tarball — неполным: именно так
 * подпуть ./animate уже выпадал из -dist артефакта. Поэтому гейт упаковывает
 * пакет, ставит локальный tarball в чистый временный consumer и проверяет ESM,
 * CJS-подпуть, TypeScript declarations и отсутствие внутренних исходников.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/animate/index.js',
  'dist/animate/index.cjs',
  'dist/animate/index.d.ts',
];

const FORBIDDEN_PATHS = [
  '.github',
  'anatomy',
  'scripts',
  'semantics',
  'src',
  'svg',
  'test',
  'tests',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsup.config.ts',
  'dist/svg',
  'dist/anatomy.json',
];

function listFiles(root, current = root) {
  const files = [];
  for (const name of readdirSync(current).sort()) {
    const absolute = join(current, name);
    if (statSync(absolute).isDirectory()) files.push(...listFiles(root, absolute));
    else files.push(relative(root, absolute).replaceAll('\\', '/'));
  }
  return files;
}

/** Проверяет уже установленное содержимое node_modules/@labpics/icons. */
export function validateInstalledPackage(packageRoot) {
  const errors = [];

  for (const path of REQUIRED_FILES) {
    if (!existsSync(join(packageRoot, path))) errors.push(`в tarball отсутствует ${path}`);
  }
  for (const path of FORBIDDEN_PATHS) {
    if (existsSync(join(packageRoot, path))) errors.push(`tarball содержит внутренний путь ${path}`);
  }

  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  } catch (error) {
    errors.push(`package.json установленного пакета не читается (${error.message})`);
  }

  if (pkg) {
    if (pkg.name !== '@labpics/icons') errors.push(`package name изменён: ${String(pkg.name)}`);
    if (pkg.sideEffects !== false) errors.push('sideEffects обязан оставаться false');
    if (pkg.exports?.['.']?.import !== './dist/index.js') {
      errors.push('root ESM export не указывает на ./dist/index.js');
    }
    if (pkg.exports?.['.']?.types !== './dist/index.d.ts') {
      errors.push('root types export не указывает на ./dist/index.d.ts');
    }
    if (pkg.exports?.['./animate']?.import !== './dist/animate/index.js') {
      errors.push('./animate ESM export не указывает на ./dist/animate/index.js');
    }
    if (pkg.exports?.['./animate']?.require !== './dist/animate/index.cjs') {
      errors.push('./animate CJS export не указывает на ./dist/animate/index.cjs');
    }
    if (pkg.exports?.['./animate']?.types !== './dist/animate/index.d.ts') {
      errors.push('./animate types export не указывает на ./dist/animate/index.d.ts');
    }
  }

  return { errors, files: existsSync(packageRoot) ? listFiles(packageRoot) : [] };
}

/**
 * Node не запускает `.cmd` напрямую через execFileSync на современных Windows
 * (EINVAL после security hardening). Используем явный системный command
 * processor без `shell: true`: executable и все аргументы остаются раздельными.
 */
export function pnpmInvocation(
  args,
  {
    platform = process.platform,
    command = platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    comspec = process.env.ComSpec || 'cmd.exe',
  } = {},
) {
  if (platform === 'win32') {
    return { file: comspec, args: ['/d', '/s', '/c', command, ...args] };
  }
  return { file: command, args };
}

function runPnpm(args, options, commandOptions) {
  const invocation = pnpmInvocation(args, commandOptions);
  return execFileSync(invocation.file, invocation.args, {
    ...options,
    windowsHide: true,
  });
}

function commandFailure(error) {
  const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8') : String(error.stdout ?? '');
  const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : String(error.stderr ?? '');
  return [error.message, stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
}

/** Полный pack/install/import/typecheck smoke. */
export function checkPackageArtifact({
  root = ROOT,
  platform = process.platform,
  pnpmCommand = platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  comspec = process.env.ComSpec || 'cmd.exe',
} = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'lab-icons-package-'));
  const packDir = join(temp, 'pack');
  const consumer = join(temp, 'consumer');
  const commandOptions = { platform, command: pnpmCommand, comspec };
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumer, { recursive: true });

  try {
    runPnpm(
      ['pack', '--pack-destination', packDir],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
      commandOptions,
    );

    const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      return { errors: [`pnpm pack обязан создать один tarball; найдено ${tarballs.length}`], files: [] };
    }
    const tarball = join(packDir, tarballs[0]);
    const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify(
        {
          name: 'lab-icons-artifact-consumer',
          private: true,
          type: 'module',
          packageManager: rootPackage.packageManager,
          dependencies: { '@labpics/icons': pathToFileURL(tarball).href },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // --no-lockfile отключает CI-default frozen-lockfile в пустом consumer.
    // --offline доказывает, что установка не зависит от registry/network.
    runPnpm(
      ['install', '--offline', '--ignore-scripts', '--no-lockfile', '--store-dir', join(temp, 'store')],
      { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      commandOptions,
    );

    const installed = join(consumer, 'node_modules', '@labpics', 'icons');
    const result = validateInstalledPackage(installed);
    if (result.errors.length > 0) return result;

    writeFileSync(
      join(consumer, 'smoke.mjs'),
      `import { accessibilityOutline } from '@labpics/icons';\n` +
        `import { animatableNames, iconClass } from '@labpics/icons/animate';\n` +
        `if (typeof accessibilityOutline !== 'string' || !accessibilityOutline.includes('<svg')) throw new Error('root ESM export broken');\n` +
        `if (!animatableNames().includes('reload') || typeof iconClass('reload') !== 'string') throw new Error('animate ESM export broken');\n`,
      'utf8',
    );
    execFileSync(process.execPath, [join(consumer, 'smoke.mjs')], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    writeFileSync(
      join(consumer, 'smoke.cjs'),
      `const api = require('@labpics/icons/animate');\n` +
        `if (typeof api.animateIcon !== 'function' || typeof api.iconClass !== 'function') throw new Error('animate CJS export broken');\n`,
      'utf8',
    );
    execFileSync(process.execPath, [join(consumer, 'smoke.cjs')], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    writeFileSync(
      join(consumer, 'smoke.ts'),
      `import { accessibilityOutline, type IconName } from '@labpics/icons';\n` +
        `import { animateIcon, type AnimateIconOptions } from '@labpics/icons/animate';\n` +
        `const svg: string = accessibilityOutline;\n` +
        `const name: IconName = 'accessibilityOutline';\n` +
        `const options: AnimateIconOptions = { name: 'reload', variant: 'outline' };\n` +
        `void [svg, name, options, animateIcon];\n`,
      'utf8',
    );
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            lib: ['ES2022', 'DOM'],
            strict: true,
            noEmit: true,
            skipLibCheck: false,
          },
          include: ['smoke.ts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    execFileSync(
      process.execPath,
      [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(consumer, 'tsconfig.json')],
      { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    return result;
  } catch (error) {
    return { errors: [`package artifact smoke упал:\n${commandFailure(error)}`], files: [] };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { errors, files } = checkPackageArtifact();
  if (errors.length > 0) {
    console.error(`check-package-artifact: HARD — ${errors.length} нарушений:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`check-package-artifact: OK — установленный tarball чист; ${files.length} файлов, ESM/CJS/types работают`);
}
