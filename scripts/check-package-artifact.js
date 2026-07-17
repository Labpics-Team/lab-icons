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
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  installedAllowlist,
  validatePackageProjection,
  validateReleaseContract,
} from './lib/release-contract.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CLEAN_PACK_EXCLUDES = new Set([
  '.git',
  '.treeshake-tmp',
  'coverage',
  'demo',
  'dist',
  'node_modules',
  'preview',
  'tmp',
]);

/**
 * Создаёт source-only checkout для pack-smoke.
 *
 * Проверка из рабочего дерева опасна: старый dist мог случайно закрыть
 * отсутствующий build step. Копия намеренно не получает ни одного build
 * output; node_modules подключается только как инструментальная зависимость.
 * Поэтому единственный путь к десяти release-файлам — lifecycle prepack →
 * канонический pnpm build.
 */
export function createCleanPackSource(root, destination) {
  if (!existsSync(join(root, 'node_modules'))) {
    throw new Error('package artifact: node_modules отсутствует; сначала pnpm install --frozen-lockfile');
  }
  cpSync(root, destination, {
    recursive: true,
    filter(source) {
      const path = relative(root, source).replaceAll('\\', '/');
      if (!path) return true;
      const [top] = path.split('/');
      return !CLEAN_PACK_EXCLUDES.has(top) && !path.endsWith('.tgz');
    },
  });
  const tooling = join(destination, 'node_modules');
  // Node 20 fs.cp на Windows может оставить destination placeholder для
  // исключённого непустого pnpm node_modules (его junction-дерево уже не
  // копируется). Удаление placeholder сохраняет один источник tooling и
  // делает повторное подключение детерминированным на обеих платформах.
  rmSync(tooling, { recursive: true, force: true });
  symlinkSync(join(root, 'node_modules'), tooling, 'junction');
  if (existsSync(join(destination, 'dist'))) {
    throw new Error('package artifact: clean source неожиданно содержит dist');
  }
  return destination;
}

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
export function validateInstalledPackage(packageRoot, contract) {
  const errors = [...validateReleaseContract(contract)];
  const files = existsSync(packageRoot) ? listFiles(packageRoot) : [];
  const expected = installedAllowlist(contract);
  const actualSet = new Set(files);
  const expectedSet = new Set(expected);
  for (const path of expected) {
    if (!actualSet.has(path)) errors.push(`в tarball отсутствует ${path}`);
  }
  for (const path of files) {
    if (!expectedSet.has(path)) errors.push(`tarball содержит файл вне exact allowlist: ${path}`);
  }

  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  } catch (error) {
    errors.push(`package.json установленного пакета не читается (${error.message})`);
  }

  if (pkg) {
    errors.push(...validatePackageProjection(pkg, contract));
    if (pkg.sideEffects !== false) errors.push('sideEffects обязан оставаться false');
  }

  for (const file of contract.files ?? []) {
    if (!/\.(?:c?js)$/.test(file)) continue;
    const absolute = join(packageRoot, file);
    if (!existsSync(absolute)) continue;
    const source = readFileSync(absolute, 'utf8');
    if (/sourceMappingURL|["']sourcesContent["']/.test(source)) {
      errors.push(`${file} содержит sourcemap/sourcesContent metadata`);
    }
  }

  return { errors, files };
}

/** Меняет координату, сохраняя path command topology. */
export function mutateFirstPathCoordinate(source, exportName = 'accessibilityOutline') {
  const start = source.indexOf(`export const ${exportName} =`);
  if (start < 0) throw new Error(`не найден export ${exportName}`);
  const end = source.indexOf('\n', start);
  const lineEnd = end < 0 ? source.length : end;
  const line = source.slice(start, lineEnd);
  const pathStart = line.indexOf(' d="');
  if (pathStart < 0) throw new Error(`${exportName} не содержит path d`);
  const beforePath = line.slice(0, pathStart + 4);
  const path = line.slice(pathStart + 4);
  const mutatedPath = path.replace(/([Mm])(-?(?:\d+(?:\.\d*)?|\.\d+))/, (_, command, raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`координата ${raw} не конечна`);
    return `${command}${(value + 0.001).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
  });
  if (mutatedPath === path) throw new Error(`${exportName} path не содержит начальную M-координату`);
  return source.slice(0, start) + beforePath + mutatedPath + source.slice(lineEnd);
}

/** Добавляет визуально значимый clip без изменения path-data. */
export function mutateExportWithHalfCanvasClip(source, exportName = 'accessibilityOutline') {
  const start = source.indexOf(`export const ${exportName} =`);
  if (start < 0) throw new Error(`не найден export ${exportName}`);
  const end = source.indexOf('\n', start);
  const lineEnd = end < 0 ? source.length : end;
  const line = source.slice(start, lineEnd);
  const svgStart = line.indexOf('<svg');
  const openEnd = line.indexOf('>', svgStart);
  const closeStart = line.lastIndexOf('</svg>');
  if (svgStart < 0 || openEnd < 0 || closeStart <= openEnd) {
    throw new Error(`${exportName} не содержит целый SVG`);
  }
  const opening = line.slice(0, openEnd + 1);
  const body = line.slice(openEnd + 1, closeStart);
  const closing = line.slice(closeStart);
  const clipped = opening +
    '<g clip-path="url(#hostile-half)">' + body + '</g>' +
    '<defs><clipPath id="hostile-half"><path d="M0 0H12V24H0Z"/></clipPath></defs>' +
    closing;
  return source.slice(0, start) + clipped + source.slice(lineEnd);
}

/** Добавляет второй viewport, сохраняя все path-data байт-в-байт. */
export function mutateExportWithNestedSvgViewport(source, exportName = 'accessibilityOutline') {
  const start = source.indexOf(`export const ${exportName} =`);
  if (start < 0) throw new Error(`не найден export ${exportName}`);
  const end = source.indexOf('\n', start);
  const lineEnd = end < 0 ? source.length : end;
  const line = source.slice(start, lineEnd);
  const svgStart = line.indexOf('<svg');
  const openEnd = line.indexOf('>', svgStart);
  const closeStart = line.lastIndexOf('</svg>');
  if (svgStart < 0 || openEnd < 0 || closeStart <= openEnd) {
    throw new Error(`${exportName} не содержит целый SVG`);
  }
  const opening = line.slice(0, openEnd + 1);
  const body = line.slice(openEnd + 1, closeStart);
  const closing = line.slice(closeStart);
  const nested = opening +
    '<svg viewBox="0 0 48 48" width="24" height="24">' + body + '</svg>' +
    closing;
  return source.slice(0, start) + nested + source.slice(lineEnd);
}

/** CSS escape меняет browser fill-rule, сохраняя исходную d-строку. */
export function mutateExportWithEscapedFillRule(source, exportName = 'accessibilityOutline') {
  const start = source.indexOf(`export const ${exportName} =`);
  if (start < 0) throw new Error(`не найден export ${exportName}`);
  const end = source.indexOf('\n', start);
  const lineEnd = end < 0 ? source.length : end;
  const line = source.slice(start, lineEnd);
  const pathStart = line.indexOf('<path ');
  if (pathStart < 0) throw new Error(`${exportName} не содержит <path>`);
  const pathEnd = line.indexOf('>', pathStart);
  if (pathEnd < 0) throw new Error(`${exportName} содержит незакрытый <path>`);
  const pathTag = line.slice(pathStart, pathEnd + 1);
  // Две обратные косые остаются валидным escape в JS template literal и
  // материализуют один CSS escape в runtime SVG.
  const hostileAttribute = 'fill-rule="\\\\65 venodd"';
  const existing = /fill-rule\s*=\s*(?:"[^"]*"|'[^']*')/i;
  const hostileTag = existing.test(pathTag)
    ? pathTag.replace(existing, hostileAttribute)
    : pathTag.replace('<path ', `<path ${hostileAttribute} `);
  const mutated = line.slice(0, pathStart) + hostileTag + line.slice(pathEnd + 1);
  return source.slice(0, start) + mutated + source.slice(lineEnd);
}

/** Удаляет один канонический атрибут только у корневого SVG export. */
export function mutateExportWithoutRootAttribute(
  source,
  attribute,
  exportName = 'accessibilityOutline',
) {
  const expectedValues = {
    fill: 'currentColor',
    width: '24',
    height: '24',
    viewBox: '0 0 24 24',
  };
  if (!Object.hasOwn(expectedValues, attribute)) {
    throw new Error(`неподдерживаемый root SVG attribute ${attribute}`);
  }
  const expected = expectedValues[attribute];

  const start = source.indexOf(`export const ${exportName} =`);
  if (start < 0) throw new Error(`не найден export ${exportName}`);
  const end = source.indexOf('\n', start);
  const lineEnd = end < 0 ? source.length : end;
  const line = source.slice(start, lineEnd);
  const svgStart = line.indexOf('<svg');
  const openEnd = line.indexOf('>', svgStart);
  if (svgStart < 0 || openEnd < 0) {
    throw new Error(`${exportName} не содержит открывающий root SVG`);
  }

  const opening = line.slice(svgStart, openEnd + 1);
  const escapedValue = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rootAttribute = new RegExp(
    `\\s+${attribute}\\s*=\\s*(?:"${escapedValue}"|'${escapedValue}')`,
  );
  const match = rootAttribute.exec(opening);
  if (!match) {
    throw new Error(`${exportName} root не содержит literal ${attribute}="${expected}"`);
  }
  if (rootAttribute.test(opening.slice(match.index + match[0].length))) {
    throw new Error(`${exportName} root содержит дублированный attribute ${attribute}`);
  }

  const mutatedOpening =
    opening.slice(0, match.index) + opening.slice(match.index + match[0].length);
  const mutatedLine =
    line.slice(0, svgStart) + mutatedOpening + line.slice(openEnd + 1);
  return source.slice(0, start) + mutatedLine + source.slice(lineEnd);
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

/**
 * Локальный tarball задаётся относительным file-specifier, не file:// URL.
 * WHATWG URL корректно кодирует `~` как `%7E`, но pnpm на Windows интерпретировал
 * DOS 8.3 segment `RUNNER~1` буквально как `RUNNER%7E1` и искал несуществующий
 * путь. Относительный specifier не проходит через URL-percent-encoding и
 * переносим между POSIX и Windows; slash нормализуется для package.json.
 */
export function localTarballSpecifier(fromDir, tarball, relativePath = relative) {
  const path = relativePath(fromDir, tarball).replaceAll('\\', '/');
  if (!path || path.startsWith('/')) {
    throw new Error(`package artifact: tarball обязан быть относительным к consumer; найдено ${path || '<empty>'}`);
  }
  return `file:${path}`;
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
  const cleanSource = join(temp, 'source');
  const packDir = join(temp, 'pack');
  const consumer = join(temp, 'consumer');
  const commandOptions = { platform, command: pnpmCommand, comspec };
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumer, { recursive: true });

  try {
    createCleanPackSource(root, cleanSource);
    const contract = JSON.parse(readFileSync(join(root, 'release/contract.json'), 'utf8'));
    const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const projectionErrors = [
      ...validateReleaseContract(contract),
      ...validatePackageProjection(rootPackage, contract),
    ];
    if (projectionErrors.length > 0) return { errors: projectionErrors, files: [] };

    runPnpm(
      ['pack', '--pack-destination', packDir],
      {
        // pnpm pack запускает prepack. В source-копии dist отсутствует, так
        // что smoke доказывает именно clean lifecycle, а не локальный кэш.
        cwd: cleanSource,
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
    const tarballSpecifier = localTarballSpecifier(consumer, tarball);

    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify(
        {
          name: 'lab-icons-artifact-consumer',
          private: true,
          type: 'module',
          packageManager: rootPackage.packageManager,
          dependencies: { '@labpics/icons': tarballSpecifier },
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
    const result = validateInstalledPackage(installed, contract);
    if (result.errors.length > 0) return result;

    writeFileSync(
      join(consumer, 'smoke.mjs'),
      `import { accessibilityOutline } from '@labpics/icons';\n` +
        `import { animatableNames, iconClass } from '@labpics/icons/animate';\n` +
        `import * as fullIr from '@labpics/icons/ir';\n` +
        `import { axisNames, calendarNumberGlyph, glyph, iconIds } from '@labpics/icons/ir';\n` +
        `import { buildDirectionalArrow } from '@labpics/icons/ir/recipes';\n` +
        `if (typeof accessibilityOutline !== 'string' || !accessibilityOutline.includes('<svg')) throw new Error('root ESM export broken');\n` +
        `if (!animatableNames().includes('reload') || typeof iconClass('reload') !== 'string') throw new Error('animate ESM export broken');\n` +
        `if ('buildDirectionalArrow' in fullIr) throw new Error('full IR leaks lightweight recipe surface');\n` +
        `const ir = glyph({ icon: 'accessibility', variant: 'outline', modelMode: 'source-only' });\n` +
        `const calendar = calendarNumberGlyph({ date: new Date('2026-07-16T12:00:00Z'), timeZone: 'UTC', opsz: 24 });\n` +
        `const arrow = buildDirectionalArrow({ orientation: 'forward', shaftLength: 0.52 });\n` +
        `if (iconIds.length !== 222 || axisNames.length !== 3 || !Object.isFrozen(iconIds) || !Object.isFrozen(axisNames) || ir.provenance.kind !== 'source' || ir.parts.length < 1) throw new Error('ir ESM export broken');\n` +
        `for (const icon of iconIds) for (const variant of ['outline', 'filled']) glyph({ icon, variant, modelMode: 'source-only' });\n` +
        `if (calendar.provenance.kind !== 'recipe' || calendar.provenance.context.day !== 16) throw new Error('calendar recipe broken');\n` +
        `if (arrow.parts.length !== 2 || arrow.joins?.[0]?.lowering !== 'expand-strokes-then-union') throw new Error('operator recipe broken');\n`,
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
        `import { calendarNumberGlyph, glyph, type GlyphIR, type IconId } from '@labpics/icons/ir';\n` +
        `import { buildDirectionalArrow, type RecipeResult } from '@labpics/icons/ir/recipes';\n` +
        `const svg: string = accessibilityOutline;\n` +
        `const name: IconName = 'accessibilityOutline';\n` +
        `const icon: IconId = 'reload';\n` +
        `const ir: GlyphIR = glyph({ icon, variant: 'filled' });\n` +
        `const calendar: GlyphIR = calendarNumberGlyph({ date: new Date(0), timeZone: 'UTC' });\n` +
        `const recipe: RecipeResult = buildDirectionalArrow();\n` +
        `const options: AnimateIconOptions = { name: 'reload', variant: 'outline' };\n` +
        `void [svg, name, icon, ir, calendar, recipe, options, animateIcon];\n`,
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

    // Node16 CJS обязан получить .d.cts через require.types. Runtime require
    // сам по себе этого не доказывает: прежний flat types path исполнялся, но
    // TypeScript отклонял consumer с TS1479.
    writeFileSync(
      join(consumer, 'smoke-cjs.cts'),
      `import { animateIcon, iconClass, type AnimateIconOptions } from '@labpics/icons/animate';\n` +
        `declare const svg: SVGSVGElement;\n` +
        `const options: AnimateIconOptions = { name: 'reload', variant: 'outline' };\n` +
        `const handle = animateIcon(svg, options);\n` +
        `const className: string | undefined = iconClass('reload');\n` +
        `void [handle, className];\n`,
      'utf8',
    );
    writeFileSync(
      join(consumer, 'tsconfig.cjs.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'Node16',
            moduleResolution: 'Node16',
            lib: ['ES2022', 'DOM'],
            strict: true,
            noEmit: true,
            skipLibCheck: false,
          },
          include: ['smoke-cjs.cts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    execFileSync(process.execPath, [tsc, '-p', join(consumer, 'tsconfig.cjs.json')], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const installedPackageFile = join(installed, 'package.json');
    const installedPackageSource = readFileSync(installedPackageFile, 'utf8');
    const hostileTypes = JSON.parse(installedPackageSource);
    hostileTypes.exports['./animate'].require.types = './dist/animate/index.d.ts';
    writeFileSync(installedPackageFile, `${JSON.stringify(hostileTypes, null, 2)}\n`, 'utf8');
    let cjsTypesFailure = '';
    try {
      execFileSync(process.execPath, [tsc, '-p', join(consumer, 'tsconfig.cjs.json')], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      cjsTypesFailure = commandFailure(error);
    } finally {
      writeFileSync(installedPackageFile, installedPackageSource, 'utf8');
    }
    if (!cjsTypesFailure.includes('TS1479')) {
      throw new Error(
        `CJS Node16 hostile types bite не воспроизвёл TS1479:\n${cjsTypesFailure || '<process succeeded>'}`,
      );
    }

    const rootEntry = join(installed, 'dist/index.js');
    const originalRootEntry = readFileSync(rootEntry, 'utf8');
    // Root contract bites не меняют path-data. Каждый обязан остановить
    // installed consumer на source boundary до render/hash claim.
    const hostileRootScript = join(consumer, 'hostile-root-attribute.mjs');
    writeFileSync(
      hostileRootScript,
      `import { glyph } from '@labpics/icons/ir';\n` +
        `glyph({ icon: 'accessibility', variant: 'outline', modelMode: 'source-only' });\n`,
      'utf8',
    );
    const rootAttributeBites = [
      ['fill', 'installed source svg.fill обязан быть currentColor'],
      ['width', 'source width обязан быть обязательным literal 24'],
      ['height', 'source height обязан быть обязательным literal 24'],
      ['viewBox', 'icon-geometry: viewBox не найден'],
    ];
    for (const [attribute, expectedFailure] of rootAttributeBites) {
      writeFileSync(
        rootEntry,
        mutateExportWithoutRootAttribute(originalRootEntry, attribute),
        'utf8',
      );
      let rootAttributeFailure = '';
      try {
        execFileSync(process.execPath, [hostileRootScript], {
          cwd: consumer,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        rootAttributeFailure = commandFailure(error);
      }
      // Нужен именно ранний source-contract отказ, а не поздний render/hash
      // mismatch: иначе consumer успеет получить ложный успешный geometry claim.
      if (!rootAttributeFailure.includes(expectedFailure)) {
        throw new Error(
          `root ${attribute}-mutation bite не был отклонён source-contract gate:\n` +
            `${rootAttributeFailure || '<process succeeded>'}`,
        );
      }
    }

    // Hostile bite: same topology, one changed coordinate. Если source
    // fingerprints перестанут проверять реальный root export, этот тест ложно
    // пройдёт и package gate обязан упасть.
    writeFileSync(rootEntry, mutateFirstPathCoordinate(originalRootEntry), 'utf8');
    writeFileSync(
      join(consumer, 'hostile-coordinate.mjs'),
      `import { glyph } from '@labpics/icons/ir';\n` +
        `glyph({ icon: 'accessibility', variant: 'outline', modelMode: 'source-only' });\n`,
      'utf8',
    );
    let hostileFailure = '';
    try {
      execFileSync(process.execPath, [join(consumer, 'hostile-coordinate.mjs')], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      hostileFailure = commandFailure(error);
    }
    if (!hostileFailure.includes('fingerprint drift accessibility/outline')) {
      throw new Error(
        `coordinate-mutation bite не был отклонён ожидаемым fingerprint gate:\n${hostileFailure || '<process succeeded>'}`,
      );
    }

    // Второй bite не меняет ни одной d-строки: половинный clip меняет реальные
    // чернила. Он обязан быть отвергнут границей source language, иначе per-path
    // fingerprint ложно засвидетельствует неэквивалентные root export и IR.
    writeFileSync(rootEntry, mutateExportWithHalfCanvasClip(originalRootEntry), 'utf8');
    writeFileSync(
      join(consumer, 'hostile-clip.mjs'),
      `import { glyph } from '@labpics/icons/ir';\n` +
        `glyph({ icon: 'accessibility', variant: 'outline', modelMode: 'source-only' });\n`,
      'utf8',
    );
    let hostileClipFailure = '';
    try {
      execFileSync(process.execPath, [join(consumer, 'hostile-clip.mjs')], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      hostileClipFailure = commandFailure(error);
    }
    if (!hostileClipFailure.includes('неэквивалентный clipPath запрещён')) {
      throw new Error(
        `clip-semantics bite не был отклонён source-language gate:\n${hostileClipFailure || '<process succeeded>'}`,
      );
    }

    // Третий bite тоже сохраняет d байт-в-байт, но nested viewBox масштабирует
    // браузерный root export. IR не имеет второго viewport и обязан отказать.
    writeFileSync(rootEntry, mutateExportWithNestedSvgViewport(originalRootEntry), 'utf8');
    writeFileSync(
      join(consumer, 'hostile-nested-viewport.mjs'),
      `import { glyph } from '@labpics/icons/ir';\n` +
        `glyph({ icon: 'accessibility', variant: 'outline', modelMode: 'source-only' });\n`,
      'utf8',
    );
    let hostileViewportFailure = '';
    try {
      execFileSync(process.execPath, [join(consumer, 'hostile-nested-viewport.mjs')], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      hostileViewportFailure = commandFailure(error);
    }
    if (!hostileViewportFailure.includes('ровно один корневой <svg>')) {
      throw new Error(
        `nested-viewport bite не был отклонён source-language gate:\n${hostileViewportFailure || '<process succeeded>'}`,
      );
    }

    // CSS `\65 venodd` вычисляется браузером как evenodd, но байты d и
    // command topology остаются прежними. Package boundary обязана доказать,
    // что такой обход fingerprint fail-closed отклонён.
    writeFileSync(rootEntry, mutateExportWithEscapedFillRule(originalRootEntry), 'utf8');
    writeFileSync(
      join(consumer, 'hostile-fill-rule.mjs'),
      `import { glyph } from '@labpics/icons/ir';\n` +
        `glyph({ icon: 'accessibility', variant: 'outline', modelMode: 'source-only' });\n`,
      'utf8',
    );
    let hostileFillRuleFailure = '';
    try {
      execFileSync(process.execPath, [join(consumer, 'hostile-fill-rule.mjs')], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      hostileFillRuleFailure = commandFailure(error);
    }
    if (!hostileFillRuleFailure.includes('неканонический fill-rule')) {
      throw new Error(
        `escaped fill-rule bite не был отклонён source-language gate:\n` +
          `${hostileFillRuleFailure || '<process succeeded>'}`,
      );
    }

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
  console.log(
    `check-package-artifact: OK — установленный tarball чист; ${files.length} файлов, ` +
      'ESM/CJS+Node16 types, 444 source fingerprints, root-attributes/coordinate/clip/viewport/fill-rule bites работают',
  );
}
