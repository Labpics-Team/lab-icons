import { sha256, stableJSON } from './author-oracle.js';

const SYMBOL_NAME = /^[a-z][a-z0-9-]*$/;

function checkedIcons(icons) {
  if (!Array.isArray(icons) || !icons.length || Array.from(icons).some(icon => typeof icon !== 'string' || !SYMBOL_NAME.test(icon)) ||
      new Set(icons).size !== icons.length) throw new TypeError('loading control: нужны неповторные публичные symbol names');
  return [...icons].sort();
}

/** Полнота берётся из проверенного author report и независимой release-проекции. */
export function verifiedLoadingIcons(authorReport, publicIcons) {
  const icons = checkedIcons(Object.keys(authorReport?.icons ?? {}));
  const published = checkedIcons(publicIcons);
  if (authorReport.failure || !/^[a-f0-9]{64}$/.test(authorReport.manifestSha256 ?? '') ||
      authorReport.expectedCounts?.families !== icons.length || authorReport.expectedCounts?.variants !== icons.length * 2 ||
      authorReport.completed !== icons.length * 2 || stableJSON(icons) !== stableJSON(published) ||
      icons.some(icon => ['outline', 'filled'].some(variant => {
        const expected = authorReport.icons[icon]?.[variant];
        return expected?.icon !== icon || expected.variant !== variant || !/^[a-f0-9]{64}$/.test(expected.svgSha256 ?? '');
      }))) throw new Error('loading control: author manifest и публичная поверхность неполны или расходятся');
  return icons;
}

/** Обычный registry остаётся доступен оптимизатору; источник не принуждает retention. */
export function loadingAdapterSource(icons, icon, label) {
  const names = checkedIcons(icons);
  if (!names.includes(icon) || !['eager-registry', 'direct-icon'].includes(label)) throw new TypeError('loading control: неизвестный icon или adapter');
  const specifier = name => JSON.stringify(`@labpics/icons/symbols/${name}`);
  const imports = label === 'eager-registry'
    ? names.map((name, index) => `import { glyph as glyph${index} } from ${specifier(name)};`).join('\n')
    : `import { glyph as selectedGlyph } from ${specifier(icon)};`;
  const registry = label === 'eager-registry'
    ? `const registry = { ${names.map((name, index) => `${JSON.stringify(name)}: glyph${index}`).join(', ')} };\nconst selectedGlyph = registry[${JSON.stringify(icon)}];\n`
    : '';
  return `${imports}\nexport { outline } from ${specifier(icon)};\n${registry}export const glyph = request => selectedGlyph(request);\nexport const create = () => glyph().svg;\n`;
}

/** Весь GlyphIR, включая provenance, совпадает до измерения горячего пути. */
export function validateLoadingIdentity(left, right) {
  if (!left?.glyph || !right?.glyph || typeof left.staticSvg !== 'string' || typeof right.staticSvg !== 'string' ||
      typeof left.glyph.svg !== 'string' || stableJSON(left.glyph) !== stableJSON(right.glyph) || left.staticSvg !== right.staticSvg) {
    throw new Error('loading control: GlyphIR, SVG или provenance различаются');
  }
  return { glyphSha256: sha256(stableJSON(left.glyph)), svgSha256: sha256(left.glyph.svg),
    staticSvgSha256: sha256(left.staticSvg), completedBytes: left.glyph.svg.length };
}

/** Lifecycle внешнего process отделён от существующего measurement interval. */
export async function withIndependentBrowser(chromium, measure) {
  const browser = await chromium.launch({ headless: true });
  try { return await measure(browser); }
  finally { await browser.close(); }
}

function symbolGraph(inputs, field) {
  if (!Array.isArray(inputs) || Array.from(inputs).some(row => !row || typeof row.file !== 'string' || !row.file ||
      !Number.isSafeInteger(row[field]) || row[field] < (field === 'bytesInOutput' ? 1 : 0))) return null;
  const symbols = new Map();
  for (const row of inputs) {
    const icon = row.file.replaceAll('\\', '/').match(/(?:^|\/)dist\/symbols\/([a-z][a-z0-9-]*)\.js$/)?.[1];
    if (icon) symbols.set(icon, (symbols.get(icon) ?? 0) + row[field]);
  }
  return [...symbols].sort(([left], [right]) => left.localeCompare(right)).map(([icon, bytes]) => ({ icon, [field]: bytes }));
}

/** Parsed imports не подтверждают сохранение registry в shipped output. */
export function inspectLoadingGraphs(bundles, icons, icon) {
  const expected = checkedIcons(icons);
  if (!expected.includes(icon)) throw new TypeError('loading control: выбранный icon отсутствует');
  if (!Array.isArray(bundles) || bundles.length !== 2 || new Set(bundles.map(bundle => bundle?.label)).size !== 2 ||
      bundles.some(bundle => !['eager-registry', 'direct-icon'].includes(bundle?.label))) {
    return { status: 'INCOMPLETE', reason: 'MISSING_LOADING_BUNDLES' };
  }
  const graphs = bundles.map(bundle => ({ label: bundle.label,
    parsedSymbols: symbolGraph(bundle.inputs, 'bytes'), retainedSymbols: symbolGraph(bundle.retainedInputs, 'bytesInOutput') }));
  if (graphs.some(graph => graph.parsedSymbols === null || graph.retainedSymbols === null)) {
    return { status: 'INCOMPLETE', reason: 'INVALID_LOADING_GRAPH', graphs };
  }
  const registry = graphs.find(graph => graph.label === 'eager-registry');
  const direct = graphs.find(graph => graph.label === 'direct-icon');
  const names = graph => graph.retainedSymbols.map(row => row.icon).sort();
  if (stableJSON(names(direct)) !== stableJSON([icon])) return { status: 'INCOMPLETE', reason: 'DIRECT_ICON_GRAPH_UNQUALIFIED', graphs };
  if (stableJSON(names(registry)) !== stableJSON(expected)) {
    return { status: 'INCOMPLETE', reason: 'EAGER_REGISTRY_NOT_RETAINED', finding: 'negative-control: ordinary bundler eliminated or changed the catalog; no full-catalog loading attribution', graphs };
  }
  return { status: 'QUALIFIED', reason: 'SAME_ARTIFACT_ALL_SYMBOLS_VERSUS_ONE', graphs };
}
