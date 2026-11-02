#!/usr/bin/env node
/**
 * Проверка реального package artifact, а не рабочего дерева.
 *
 * Сборка может быть зелёной, а опубликованный tarball — неполным. Поэтому гейт
 * упаковывает пакет, ставит локальный tarball в чистый временный consumer и
 * проверяет все ESM entrypoints, TypeScript declarations и отсутствие
 * внутренних исходников.
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
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  toNamespacedPath,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  installedAllowlist,
  validatePackageProjection,
  validateReleaseContract,
  validateReleaseTypeDependencyGraph,
  validateReleaseRuntimeDependencyGraph,
} from './lib/release-contract.js';
import {
  EXPECTED_ICON_NAMES,
  EXPECTED_SOURCE_VARIANTS,
} from './lib/corpus-contract.js';
import { loadAuthorBaseline } from './lib/author-baseline.js';
import { compileAuthorAnatomy } from './lib/author-anatomy.js';
import { expectedAuthorEffect, expectedAuthorMotion } from './bench/author-oracle.js';
import { statePackageExpectations, stateArtifactConsumerSource } from './lib/state-artifact-consumer.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Expected metadata относится только к проверенному annotation/master, не к installed output. */
export function authorPackageExpectations(baseline, annotations) {
  const contracts = compileAuthorAnatomy(baseline, annotations);
  return Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon,
    Object.fromEntries(Object.entries(variants).map(([variant, record]) => {
      const contract = contracts[`${icon}/${variant}`] ?? record.sourceContract;
      const sourcePaths = [...record.normalizedSvg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
      return [variant, {
        master: record.master, author: record.author, svg: record.artifactSvg,
        anatomy: contract.anatomy ?? null,
        variation: contract.variation ? { geometrySha256: contract.variation.geometrySha256, domain: contract.variation.domain } : null,
        motion: expectedAuthorMotion(contract, { kind: 'package', svg: record.normalizedSvg, compositionKind: 'layers' }),
        effects: Object.fromEntries((contract.gestures ?? []).map(gesture => [gesture.id, expectedAuthorEffect(gesture)])),
        parts: contract.parts.map(({ id, role, identity, fillRule, zIndex, sourceFingerprint, artifactFingerprint, anchor }, index) => ({
          id, fillRule, zIndex, sourceFingerprint, artifactFingerprint, d: sourcePaths[index], role, identity,
          anchorSource: contract.anatomy && anchor ? 'declared' : 'geometry-bbox-center',
          ...(contract.anatomy && anchor && { anchor }),
        })),
      }];
    })),
  ]));
}

/** Оба type consumers получают весь semantic census, а не один выбранный модуль. */
export function stateTypeConsumerSource(expected, { dynamicImport = false } = {}) {
  const entries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  const allStates = [...new Set(entries.flatMap(([, group]) => group.states.map(state => state.id)))];
  const sampler = entries.some(([, group]) => group.law === 'dots.orient')
    ? (dynamicImport ? "const { prepareContourStateEffect } = await import('@labpics/icons/motion');\n" : "import { prepareContourStateEffect } from '@labpics/icons/motion';\n") : '';
  return sampler + entries.map(([name, group], index) => {
    const module = `stateGroup${index}`;
    const stateType = `State${index}`;
    const path = JSON.stringify(`@labpics/icons/states/${name}`);
    const states = group.states.map(state => state.id);
    const state = JSON.stringify(group.defaultState);
    const foreign = allStates.find(id => !states.includes(id));
    const contour = group.law === 'dots.orient';
    return [
      dynamicImport ? `const ${module} = await import(${path});` : `import * as ${module} from ${path};`,
      `type ${stateType} = import(${path}).State;`,
      `const defaultState${index}: ${stateType} = ${state};`,
      `const defaultSvg${index} = ${module}.render();`,
      `const defaultMount${index} = ${module}.renderStateSvg();`,
      `const declaredStates${index}: readonly ${stateType}[] = ${JSON.stringify(states)};`,
      `const exactState${index}: ${states.map(id => JSON.stringify(id)).join(' | ')} = ${module}.stateCapabilities().states[0]!.id;`,
      `for (const state of declaredStates${index}) {`,
      `  const svg = ${module}.render(state);`,
      `  const mounted = ${module}.renderStateSvg(state);`,
      `  const effect = ${module}.compileStateEffect(state, { duration: 300, reducedMotion: true });`,
      `  const exported = ${module}.exportStateTransition(state, { duration: 300, format: 'web-effect' });`,
      `  if (svg.ok) { const markup: string = svg.svg; void markup; }`,
      ...(contour ? [
        `  if (effect.ok) {`,
        `    const property: 'd' = effect.effect.targets[0]!.property;`,
        `    const prepared = prepareContourStateEffect(effect.effect);`,
        `    if (prepared.ok) { const pose = prepared.sample(.37); if (pose.ok) { const d: string = pose.parts[0]!.d; void d; } }`,
        `    // @ts-expect-error контурный переход не получает opacity stages`,
        `    const stages = effect.effect.stages;`,
        `    void [property, prepared, stages];`,
        `  }`,
      ] : [`  if (effect.ok) { const property: 'opacity' = effect.effect.stages[0]!.property; void property; }`]),
      `  void [mounted, exported];`,
      `}`,
      ...(contour ? [
        `${module}.compileStateEffect(defaultState${index}, { duration: 300, from: .37, variation: { dotScale: 1, spacingScale: 1 } });`,
        `const rounding${index}: string = ${module}.stateCapabilities().proof.roundingNormUpper.numerator;`,
        `// @ts-expect-error variation не принимает координаты или произвольный radius`,
        `${module}.render(defaultState${index}, { variation: { radius: 1 } });`,
        `void rounding${index};`,
      ] : []),
      // Filled — допустимый запрос с typed runtime refusal, не ошибка типов.
      `const filled${index} = ${module}.render(defaultState${index}, { variant: 'filled' });`,
      `if (!filled${index}.ok) { const code: string = filled${index}.reason.code; void code; }`,
      `// @ts-expect-error неизвестный semantic state не входит в точный union`,
      `const invalidState${index}: ${stateType} = '__unsupported_state__';`,
      `// @ts-expect-error unknown state не принимается публичным render`,
      `${module}.render('__unsupported_state__');`,
      ...(states.includes('error') ? [] : [
        `// @ts-expect-error application error не назначается знаком без явного declaration`,
        `${module}.render('error');`,
      ]),
      `// @ts-expect-error state request не принимает private path coordinates`,
      `${module}.render(defaultState${index}, { d: 'M0 0' });`,
      `// @ts-expect-error null не подменяет optional render request`,
      `${module}.renderStateSvg(defaultState${index}, null);`,
      `// @ts-expect-error variant имеет конечный публичный domain`,
      `${module}.render(defaultState${index}, { variant: 'weight' });`,
      contour ? `// @ts-expect-error from — численное положение, имя состояния не принимается` : `// @ts-expect-error takeover получает current opacity от executor, from не объявлен`,
      `${module}.compileStateEffect(defaultState${index}, { duration: 300, from: ${state} });`,
      `// @ts-expect-error effect duration принимает число`,
      `${module}.compileStateEffect(defaultState${index}, { duration: '300' });`,
      `// @ts-expect-error effect request не принимает null`,
      `${module}.compileStateEffect(defaultState${index}, null);`,
      `// @ts-expect-error неизвестный format не входит в публичный export request`,
      `${module}.exportStateTransition(defaultState${index}, { duration: 300, format: '__unsupported_format__' });`,
      ...(foreign === undefined ? [] : [
        `// @ts-expect-error знак другой semantic group не расширяет State`,
        `const foreignState${index}: ${stateType} = ${JSON.stringify(foreign)};`,
        `// @ts-expect-error render не принимает знак другой semantic group`,
        `${module}.render(${JSON.stringify(foreign)});`,
        `void foreignState${index};`,
      ]),
      `void [defaultState${index}, defaultSvg${index}, defaultMount${index}, exactState${index}, invalidState${index}, filled${index}];`,
      '',
    ].join('\n');
  }).join('\n');
}

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

const NATIVE_PATH = { isAbsolute, relative };

/**
 * Проецирует путь fs.cp filter в source-relative allow/deny решение.
 *
 * Корень и source обязаны принадлежать одному path namespace. Иначе Windows
 * path.relative возвращает абсолютный \\?\-путь, а top-level denylist молча
 * перестаёт быть denylist. Неожиданную проекцию поэтому отклоняем до копии.
 */
export function shouldCopyCleanPackPath(copyRoot, source, pathApi = NATIVE_PATH) {
  const projected = pathApi.relative(copyRoot, source).replaceAll('\\', '/');
  if (!projected) return true;
  if (
    pathApi.isAbsolute(projected) ||
    projected === '..' ||
    projected.startsWith('../')
  ) {
    throw new Error(`package artifact: путь filter вне clean source root (${projected})`);
  }
  const [top] = projected.split('/');
  return !CLEAN_PACK_EXCLUDES.has(top) && !projected.endsWith('.tgz');
}

/**
 * Создаёт source-only checkout для pack-smoke.
 *
 * Проверка из рабочего дерева опасна: старый dist мог случайно закрыть
 * отсутствующий build step. Копия намеренно не получает ни одного build
 * output; node_modules подключается только как инструментальная зависимость.
 * Поэтому единственный путь к release-файлам — lifecycle prepack →
 * канонический pnpm build.
 */
export function createCleanPackSource(root, destination) {
  const resolvedRoot = resolve(root);
  const resolvedDestination = resolve(destination);
  if (!existsSync(join(resolvedRoot, 'node_modules'))) {
    throw new Error('package artifact: node_modules отсутствует; сначала pnpm install --frozen-lockfile');
  }
  // fs.cp нормализует source через toNamespacedPath до вызова filter на
  // Windows. Передаём обе исходные координаты в том же namespace, чтобы
  // relative(root, source) оставался относительным на каждой платформе.
  const copyRoot = toNamespacedPath(resolvedRoot);
  const copyDestination = toNamespacedPath(resolvedDestination);
  cpSync(copyRoot, copyDestination, {
    recursive: true,
    filter(source) {
      return shouldCopyCleanPackPath(copyRoot, source);
    },
  });
  const copiedTopLevels = new Set(readdirSync(resolvedDestination));
  for (const excluded of CLEAN_PACK_EXCLUDES) {
    if (copiedTopLevels.has(excluded)) {
      throw new Error(`package artifact: clean source неожиданно содержит ${excluded}`);
    }
  }
  const tooling = join(resolvedDestination, 'node_modules');
  symlinkSync(join(resolvedRoot, 'node_modules'), tooling, 'junction');
  return resolvedDestination;
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
  errors.push(...validateReleaseTypeDependencyGraph({
    contract,
    readText(file) {
      return readFileSync(join(packageRoot, file), 'utf8');
    },
  }));
  errors.push(...validateReleaseRuntimeDependencyGraph({
    contract,
    readText(file) { return readFileSync(join(packageRoot, file), 'utf8'); },
  }));

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
    // Анализ типов проверяет тот же clean-source tarball, что и consumer.
    // Повторный attw --pack запускал бы prepack и всю сборку ещё раз.
    const typeReport = runPnpm(
      [
        'exec', 'attw', tarball,
        '--profile', 'esm-only', '--format', 'table', '--no-emoji', '--no-color',
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      commandOptions,
    );
    process.stdout.write(typeReport);
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
    const authorBaseline = loadAuthorBaseline(cleanSource);
    const authorExpected = authorPackageExpectations(authorBaseline, JSON.parse(readFileSync(join(cleanSource, 'semantics/author-anatomy.json'), 'utf8')));
    writeFileSync(join(consumer, 'author-expected.json'), `${JSON.stringify(authorExpected)}\n`, 'utf8');
    const stateExpected = statePackageExpectations(authorBaseline,
      JSON.parse(readFileSync(join(cleanSource, 'semantics/author-state-groups.json'), 'utf8')),
      JSON.parse(readFileSync(join(cleanSource, 'semantics/grid.json'), 'utf8')));
    writeFileSync(join(consumer, 'state-expected.json'), `${JSON.stringify(stateExpected)}\n`, 'utf8');

    writeFileSync(
      join(consumer, 'smoke.mjs'),
      `import { readFileSync } from 'node:fs';\n` +
        `import { accessibilityOutline } from '@labpics/icons';\n` +
        `import * as fullIr from '@labpics/icons/ir';\n` +
        `import { axisNames, calendarNumberGlyph, glyph, glyphCapabilities, iconDesignContract, iconIds } from '@labpics/icons/ir';\n` +
        `import { buildDirectionalArrow } from '@labpics/icons/ir/recipes';\n` +
        `import { registerCandidates } from '@labpics/icons/ir/candidates';\n` +
        `import * as timeSymbol from '@labpics/icons/symbols/time';\n` +
        `import { compileSymbolEffect } from '@labpics/icons/motion';\n` +
        `import { renderGlyphSvg } from '@labpics/icons/ir/render';\n` +
        `if (typeof accessibilityOutline !== 'string' || !accessibilityOutline.includes('<svg')) throw new Error('root ESM export broken');\n` +
        `if ('buildDirectionalArrow' in fullIr) throw new Error('full IR leaks lightweight recipe surface');\n` +
        `if (typeof registerCandidates !== 'function') throw new Error('candidates ESM export broken');\n` +
        `const ir = glyph({ icon: 'accessibility', variant: 'outline', modelMode: 'source-only' });\n` +
        `const calendar = calendarNumberGlyph({ date: new Date('2026-07-16T12:00:00Z'), timeZone: 'UTC', opsz: 24 });\n` +
        `const arrow = buildDirectionalArrow({ orientation: 'forward', shaftLength: 0.52 });\n` +
        `if (iconIds.length !== ${EXPECTED_ICON_NAMES} || axisNames.length !== 3 || !Object.isFrozen(iconIds) || !Object.isFrozen(axisNames) || ir.provenance.kind !== 'source' || ir.parts.length < 1) throw new Error('ir ESM export broken');\n` +
        `if (iconDesignContract.targets.lottie !== 'not-exported' || glyphCapabilities('time', 'outline').motion.state !== 'gesture-ready' || glyphCapabilities('time', 'outline').motion.gestures[0]?.id !== 'time.advance') throw new Error('capability contract broken');\n` +
        `for (const icon of iconIds) for (const variant of ['outline', 'filled']) glyph({ icon, variant, modelMode: 'source-only' });\n` +
        `const authorExpected = JSON.parse(readFileSync(new URL('./author-expected.json', import.meta.url), 'utf8'));\n` +
        `if (Object.keys(authorExpected).length !== ${authorBaseline.counts.families}) throw new Error('current author census broken');\n` +
        `for (const [icon, variants] of Object.entries(authorExpected)) {\n` +
        `  const symbol = await import('@labpics/icons/symbols/' + icon);\n` +
        `  if (symbol.glyph() !== symbol.glyph() || !Object.isFrozen(symbol.glyph().parts)) throw new Error('symbol cache broken: ' + icon);\n` +
        `  for (const variant of ['outline', 'filled']) {\n` +
        `    const expected = variants[variant];\n` +
        `    const current = symbol.glyph({ variant });\n` +
        `    if (symbol[variant] !== expected.svg) throw new Error('current static master differs: ' + icon + '/' + variant);\n` +
        `    if (symbol.glyph({ variant, modelMode: 'source-only' }) !== current || current.icon !== icon || current.variant !== variant || current.composition.kind !== 'layers') throw new Error('current source/default differs: ' + icon + '/' + variant);\n` +
        `    if (JSON.stringify(current.viewBox) !== '[0,0,24,24]' || !/<svg\\b[^>]*\\bfill="currentColor"/.test(current.svg) || current.parts.some(part => part.paint.kind !== 'fill' || part.paint.fill !== 'currentColor')) throw new Error('current viewport/paint differs: ' + icon + '/' + variant);\n` +
        `    if (current.provenance.kind !== 'source' || current.provenance.file !== expected.master || JSON.stringify(current.provenance.author) !== JSON.stringify(expected.author) || JSON.stringify(current.provenance.anatomy ?? null) !== JSON.stringify(expected.anatomy)) throw new Error('current author provenance differs: ' + icon + '/' + variant);\n` +
        `    const actualParts = current.parts.map((part, index) => ({ id: part.id, fillRule: part.fillRule, zIndex: part.zIndex, sourceFingerprint: part.provenance.sourceFingerprint, artifactFingerprint: part.provenance.artifactFingerprint, d: part.d, role: part.role, identity: part.provenance.identity, anchorSource: part.anchorSource, ...(expected.parts[index].anchor && { anchor: part.anchor }) }));\n` +
        `    if (JSON.stringify(actualParts) !== JSON.stringify(expected.parts) || current.parts.some(part => part.provenance.kind !== 'source' || part.morphGroup !== null)) throw new Error('current source path/fill/z-order differs: ' + icon + '/' + variant);\n` +
        `    const renderedD = [...current.svg.matchAll(/<path\\b[^>]*\\bd="([^"]+)"/g)].map(match => match[1]);\n` +
        `    const renderedRules = [...current.svg.matchAll(/<path\\b[^>]*\\bfill-rule="([^"]+)"/g)].map(match => match[1]);\n` +
        `    if (JSON.stringify(renderedD) !== JSON.stringify(expected.parts.map(part => part.d)) || JSON.stringify(renderedRules) !== JSON.stringify(expected.parts.map(part => part.fillRule))) throw new Error('current SVG assembly differs: ' + icon + '/' + variant);\n` +
        `    const renderedParts = [...current.svg.matchAll(/<path\\b[^>]*\\bdata-part="([^"]+)"/g)].map(match => match[1]);\n` +
        `    const renderedRoles = [...current.svg.matchAll(/<path\\b[^>]*\\bdata-role="([^"]+)"/g)].map(match => match[1]);\n` +
        `    if (JSON.stringify(renderedParts) !== JSON.stringify(expected.parts.map(part => part.id)) || JSON.stringify(renderedRoles) !== JSON.stringify(expected.parts.map(part => part.role))) throw new Error('current rendered anatomy differs: ' + icon + '/' + variant);\n` +
        `    const capabilities = symbol.glyphCapabilities(variant);\n` +
        `    if (Object.hasOwn(capabilities, 'variation')) throw new Error('source symbol advertised opt-in variation: ' + icon + '/' + variant);\n` +
        `    if (capabilities.icon !== icon || capabilities.variant !== variant || capabilities.modelState !== null || capabilities.supportedAxes.length || Object.keys(capabilities.axes).length || JSON.stringify(capabilities.motion) !== JSON.stringify(expected.motion) || JSON.stringify(capabilities.anatomy ?? null) !== JSON.stringify(expected.anatomy) || JSON.stringify(capabilities.author) !== JSON.stringify(expected.author)) throw new Error('current source inherited stale admission: ' + icon + '/' + variant);\n` +
        `    const foreignMotion = compileSymbolEffect(current, capabilities, 'time.advance', { duration: 360 });\n` +
        `    if (foreignMotion.ok || foreignMotion.reason.code !== (expected.motion.state === 'gesture-ready' ? 'GESTURE_UNSUPPORTED' : 'SEMANTIC_MOTION_UNAVAILABLE')) throw new Error('current motion did not refuse precisely: ' + icon + '/' + variant);\n` +
        `    if (expected.variation) {\n` +
        `      const variable = await import('@labpics/icons/variations/' + icon); const variableCapabilities = variable.glyphCapabilities(variant);\n` +
        `      if (variable.glyph({ variant }) !== current || variableCapabilities.author !== capabilities.author || variableCapabilities.anatomy !== capabilities.anatomy) throw new Error('opt-in variation duplicated authored source: ' + icon + '/' + variant);\n` +
        `      if (variableCapabilities.variation?.geometrySha256 !== expected.variation.geometrySha256 || JSON.stringify(variableCapabilities.variation.domain) !== JSON.stringify(expected.variation.domain)) throw new Error('current authored variation policy differs: ' + icon + '/' + variant);\n` +
        `      if (variable.glyph({ variant, variation: { dotScale: 1, spacingScale: 1 } }) !== current) throw new Error('authored variation identity roundtripped');\n` +
        `      const varied = variable.glyph({ variant, variation: { dotScale: 1.1, spacingScale: 0.9 } });\n` +
        `      if (varied.provenance.kind !== 'authored-variation' || varied.d === current.d || varied.svg === current.svg || varied.provenance.variation.geometrySha256 !== expected.variation.geometrySha256 || JSON.stringify(varied.provenance.author) !== JSON.stringify(expected.author)) throw new Error('authored variation not materialized: ' + icon + '/' + variant);\n` +
        `      if (JSON.stringify(varied.parts.map(part => [part.id, part.fillRule, part.topologySignature])) !== JSON.stringify(current.parts.map(part => [part.id, part.fillRule, part.topologySignature])) || varied.parts.some((part, index) => part.d === current.parts[index].d || !varied.svg.includes('d="' + part.d + '"'))) throw new Error('authored variation lost parts/SVG: ' + icon + '/' + variant);\n` +
        `      for (const [gesture] of Object.entries(expected.effects)) if (!compileSymbolEffect(varied, variableCapabilities, gesture, { duration: 360 }).ok) throw new Error('authored variation lost opacity gesture');\n` +
        `      let outside = false; try { variable.glyph({ variant, variation: { dotScale: 3, spacingScale: 0.5 } }); } catch (error) { outside = error.code === 'VARIATION_OUTSIDE_DOMAIN'; }\n` +
        `      if (!outside) throw new Error('authored variation admitted overlapping controls');\n` +
        `      const lottie = await import('@labpics/icons/lottie/' + icon); const refusedTarget = lottie.exportLottie({ variant, variation: { dotScale: 1.1 } });\n` +
        `      if (refusedTarget.ok || refusedTarget.reason.code !== 'VARIATION_UNSUPPORTED') throw new Error('Lottie silently exported default geometry for variation');\n` +
        `    } else {\n` +
        `      let unsupported = false; try { symbol.glyph({ variant, variation: { dotScale: 1.1 } }); } catch (error) { unsupported = error.code === 'AUTHOR_VARIATION_UNSUPPORTED'; }\n` +
        `      if (!unsupported) throw new Error('undeclared authored geometry variation accepted: ' + icon + '/' + variant);\n` +
        `    }\n` +
        `    for (const [gesture, expectedEffect] of Object.entries(expected.effects)) {\n` +
        `      const effect = compileSymbolEffect(current, capabilities, gesture, { duration: 360 });\n` +
        `      if (!effect.ok || effect.effect.version !== expectedEffect.version || JSON.stringify(effect.effect.targets) !== JSON.stringify(expectedEffect.targets) || JSON.stringify(effect.effect.stages) !== JSON.stringify(expectedEffect.stages)) throw new Error('current declared motion differs: ' + icon + '/' + variant);\n` +
        `    }\n` +
        `    for (const request of [{ variant, axes: { weight: 1 } }, { variant, axes: { opsz: 24 } }, { variant, axes: { corner: 1 } }, { variant, modelMode: 'allow-candidate' }]) {\n` +
        `      let refused = false;\n` +
        `      try { symbol.glyph(request); } catch (error) { refused = error.code === 'AUTHOR_PARITY_REQUIRED'; }\n` +
        `      if (!refused) throw new Error('current author capability did not refuse precisely: ' + icon + '/' + variant);\n` +
        `    }\n` +
        `  }\n` +
        `}\n` +
        `const currentEffect = compileSymbolEffect(timeSymbol.glyph(), timeSymbol.glyphCapabilities(), 'time.advance', { duration: 200 });\n` +
        `if (currentEffect.ok || currentEffect.reason.code !== 'SEMANTIC_MOTION_UNAVAILABLE') throw new Error('current author inherited stale motion');\n` +
        `const effect = compileSymbolEffect(glyph({ icon: 'time' }), glyphCapabilities('time'), 'time.advance', { duration: 200 });\n` +
        `if (!effect.ok || effect.effect.targets.length !== 2) throw new Error('recorded symbol motion export broken');\n` +
        `const maskGlyph = glyph({ icon: 'time', variant: 'filled' });\n` +
        `if (renderGlyphSvg(maskGlyph, { instanceId: 'one' }) === renderGlyphSvg(maskGlyph, { instanceId: 'two' })) throw new Error('symbol mask instance isolation broken');\n` +
        `registerCandidates();\n` +
        `for (const icon of iconIds) for (const variant of ['outline', 'filled']) glyph({ icon, variant, modelMode: 'allow-candidate' });\n` +
        `if (calendar.provenance.kind !== 'recipe' || calendar.provenance.context.day !== 16) throw new Error('calendar recipe broken');\n` +
        `if (arrow.parts.length !== 2 || arrow.joins?.[0]?.lowering !== 'expand-strokes-then-union') throw new Error('operator recipe broken');\n` +
        stateArtifactConsumerSource(),
      'utf8',
    );
    execFileSync(process.execPath, [join(consumer, 'smoke.mjs')], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    writeFileSync(
      join(consumer, 'smoke.ts'),
      `import { accessibilityOutline, type IconName } from '@labpics/icons';\n` +
        `import { calendarNumberGlyph, glyph, iconDesignContract, type GlyphIR, type IconDesignContract, type IconId } from '@labpics/icons/ir';\n` +
        `import { buildDirectionalArrow, type RecipeResult } from '@labpics/icons/ir/recipes';\n` +
        `import { glyph as symbolGlyph, glyphCapabilities as symbolCapabilities } from '@labpics/icons/symbols/time';\n` +
        `import { glyph as addedGlyph, glyphCapabilities as addedCapabilities } from '@labpics/icons/symbols/align-bottom';\n` +
        `import { glyph as activityGlyph, glyphCapabilities as activityCapabilities } from '@labpics/icons/variations/ellipsis-horizontal';\n` +
        `import { glyph as verticalGlyph } from '@labpics/icons/variations/ellipsis-vertical';\n` +
        `import { glyph as sourceActivityGlyph } from '@labpics/icons/symbols/ellipsis-horizontal';\n` +
        `import { glyph as ellipseGlyph } from '@labpics/icons/symbols/ellipse';\n` +
        `import { exportLottie as exportActivityLottie } from '@labpics/icons/lottie/ellipsis-horizontal';\n` +
        `import { compileSymbolEffect, type SymbolEffectResult, type SymbolOpacityStage } from '@labpics/icons/motion';\n` +
        `import { renderGlyphSvg } from '@labpics/icons/ir/render';\n` +
        `const varied: GlyphIR = activityGlyph({ variation: { dotScale: 1.1, spacingScale: 0.9 } });\n` +
        `const verticalVaried: GlyphIR = verticalGlyph({ variant: 'filled', variation: { spacingScale: 1.1 } });\n` +
        `const authoredDomain: 'convex-linear' = activityCapabilities().variation.domain.kind;\n` +
        `type AuthorVariationGlyphRequest = Parameters<typeof activityGlyph>[0];\n` +
        `const typedVariationRequest: AuthorVariationGlyphRequest = { variation: { dotScale: 1.1 } };\n` +
        `const namedVariationKind: 'source' | 'authored-variation' = activityGlyph(typedVariationRequest).provenance.kind;\n` +
        `const exactDefaultKind: 'source' = activityGlyph().provenance.kind;\n` +
        `// @ts-expect-error: named variation не обещает exact source.\n` +
        `const falseSourcePromise: 'source' = activityGlyph(typedVariationRequest).provenance.kind;\n` +
        `// @ts-expect-error: неподдержанный symbol отвергает named variation.\n` +
        `ellipseGlyph(typedVariationRequest);\n` +
        `// @ts-expect-error: геометрия ellipse не получает triad variation по сходству.\n` +
        `ellipseGlyph({ variation: { dotScale: 1.1 } });\n` +
        `// @ts-expect-error: обычный source импорт не принимает opt-in variation.\n` +
        `sourceActivityGlyph(typedVariationRequest);\n` +
        `// @ts-expect-error: runtime не принимает controls или raw path.\n` +
        `activityGlyph({ variation: { d: 'M0 0Z' } });\n` +
        `// @ts-expect-error: target с авторскими contours не объявляет variation export.\n` +
        `exportActivityLottie({ variation: { dotScale: 1.1 } });\n` +
        `const svg: string = accessibilityOutline;\n` +
        `const name: IconName = 'accessibilityOutline';\n` +
        `const icon: IconId = 'reload';\n` +
        `const ir: GlyphIR = glyph({ icon, variant: 'filled' });\n` +
        `const calendar: GlyphIR = calendarNumberGlyph({ date: new Date(0), timeZone: 'UTC' });\n` +
        `const recipe: RecipeResult = buildDirectionalArrow();\n` +
        `const contract: IconDesignContract = iconDesignContract;\n` +
        `const sliced: GlyphIR = symbolGlyph({ variant: 'outline' });\n` +
        `const effect: SymbolEffectResult = compileSymbolEffect(sliced, symbolCapabilities(), 'time.advance', { duration: 200 });\n` +
        `const mounted: string = renderGlyphSvg(sliced, { instanceId: 'consumer' });\n` +
        `const added = addedGlyph();\n` +
        `const addedName: 'align-bottom' = added.icon;\n` +
        `const authorVersion: string = added.provenance.author.version;\n` +
        `const addedEffect: SymbolEffectResult = compileSymbolEffect(added, addedCapabilities(), 'time.advance', { duration: 200 });\n` +
        `const addedMounted: string = renderGlyphSvg(added, { instanceId: 'added' });\n` +
        `const activity = compileSymbolEffect(activityGlyph(), activityCapabilities(), 'ellipsis-horizontal.activity', { duration: 900 });\n` +
        `if (activity.ok && activity.effect.version === 2) {\n` +
        `  const stages: readonly SymbolOpacityStage[] = activity.effect.stages;\n` +
        `  const property: 'opacity' = stages[0].property;\n` +
        `  // @ts-expect-error opacity не объявляет rotate канал\n` +
        `  const rotation = activity.effect.targets[0].rotation;\n` +
        `  void [stages, property, rotation];\n` +
        `}\n` +
        `// @ts-expect-error записанный IR сохраняет собственный census\n` +
        `glyph({ icon: 'align-bottom' });\n` +
        `// @ts-expect-error символ уже связан с icon; private coordinates не принимаются\n` +
        `symbolGlyph({ icon: 'alert' });\n` +
        `void [svg, name, icon, ir, calendar, recipe, contract, sliced, effect, mounted, addedName, authorVersion, addedEffect, addedMounted, activity];\n` +
        stateTypeConsumerSource(stateExpected),
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

    writeFileSync(
      join(consumer, 'smoke-nodenext.mts'),
      `import { accessibilityOutline } from '@labpics/icons';\n` +
        `import { glyph, type GlyphIR } from '@labpics/icons/ir';\n` +
        `import { buildDirectionalArrow } from '@labpics/icons/ir/recipes';\n` +
        `import { glyph as symbolGlyph } from '@labpics/icons/symbols/alert';\n` +
        `import { glyph as addedGlyph } from '@labpics/icons/symbols/align-bottom';\n` +
        `const ir: GlyphIR = glyph({ icon: 'reload' });\n` +
        `const symbol: GlyphIR = symbolGlyph();\n` +
        `const added: GlyphIR<string> = addedGlyph();\n` +
        `const addedName: 'align-bottom' = addedGlyph().icon;\n` +
        `void [accessibilityOutline, ir, buildDirectionalArrow, symbol, added, addedName];\n` +
        stateTypeConsumerSource(stateExpected, { dynamicImport: true }),
      'utf8',
    );
    writeFileSync(
      join(consumer, 'tsconfig.nodenext.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            lib: ['ES2022', 'DOM'],
            strict: true,
            noEmit: true,
            skipLibCheck: false,
          },
          include: ['smoke-nodenext.mts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    execFileSync(
      process.execPath,
      [
        join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        join(consumer, 'tsconfig.nodenext.json'),
      ],
      { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    writeFileSync(
      join(consumer, 'smoke.cjs'),
      `try {\n` +
        `  require('@labpics/icons');\n` +
        `  throw new Error('ESM-only package unexpectedly exposed require');\n` +
        `} catch (error) {\n` +
        `  if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;\n` +
        `}\n`,
      'utf8',
    );
    execFileSync(process.execPath, [join(consumer, 'smoke.cjs')], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
      `ESM/types/attw, ${EXPECTED_SOURCE_VARIANTS} source fingerprints, root-attributes/coordinate/clip/viewport/fill-rule bites работают`,
  );
}
