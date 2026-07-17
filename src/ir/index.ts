/**
 * Публичный Glyph IR: строгая граница между точным SVG-источником и
 * доказанной параметрической моделью. Модуль не читает файлы, часы и DOM:
 * все данные попадают в браузер как статические импорты сборщика.
 */

import * as staticIcons from '@labpics/icons';
import anatomyJson from '../../semantics/anatomy.json';
import catalogJson from '../../semantics/catalog.json';
import gridJson from '../../semantics/grid.json';
import {
  AXIS_NAMES,
  ICON_IDS,
  type CatalogAxisName,
  type CatalogIconId,
} from './catalog.generated.js';

// Эти zero-IO модули пока живут рядом с инструментами геометрии. Публичные
// типы ниже намеренно не пропускают их нестрогие JS-типы через API.
// @ts-expect-error — JS-модуль будет перенесён за package boundary отдельно.
import { buildGlyphParts as buildAnatomyParts, topologySignature as computeTopologySignature } from '../../scripts/lib/anatomy-gen.js';
// @ts-expect-error — см. комментарий выше; функция чистая и bundleable.
import { sourcePathEntries } from '../../scripts/lib/icon-geometry.js';
// @ts-expect-error — см. комментарий выше; функция чистая и bundleable.
import { parsePathData, pathBBox } from '../../scripts/lib/path-data.js';
import {
  buildCalendarNumberGeometry as buildCalendarNumberRecipe,
  type CalendarNumberInput,
  type RecipeFillPaint,
  type RecipeStrokePaint,
} from './recipes.js';
import { sha256Hex } from './sha256.js';

export type IconId = CatalogIconId;
export type AxisName = CatalogAxisName;
export type IconVariant = 'outline' | 'filled';
export type ModelMode = 'accepted-only' | 'allow-candidate' | 'source-only';
export type ModelState = 'accepted' | 'candidate';
export type FillRule = 'nonzero' | 'evenodd';
export type PartRole =
  | 'body'
  | 'content'
  | 'ink'
  | 'counter'
  | 'container'
  | 'control'
  | 'detail'
  | 'decorator'
  | 'unclassified';

export interface GlyphRequest {
  readonly icon: IconId;
  readonly variant?: IconVariant;
  readonly modelMode?: ModelMode;
  readonly axes?: Readonly<Partial<Record<AxisName, number>>>;
}

export interface ParsedGlyphRequest {
  readonly icon: IconId;
  readonly variant: IconVariant;
  readonly modelMode: ModelMode;
  readonly axes: Readonly<Partial<Record<AxisName, number>>>;
}

export interface SourcePartProvenance {
  readonly kind: 'source';
  readonly identity: 'geometry-derived';
  readonly file: string;
  /** Fingerprint авторского source-path до build-оптимизации. */
  readonly sourceFingerprint: `sha256:${string}`;
  /** Fingerprint реально установленного root export после deterministic SVGO. */
  readonly artifactFingerprint: `sha256:${string}`;
}

export interface ModelPartProvenance {
  readonly kind: 'model';
  readonly identity: 'declared';
  readonly declaration: IconId;
  readonly state: ModelState;
}

export interface RecipePartProvenance {
  readonly kind: 'recipe';
  readonly identity: 'declared';
  readonly recipe: string;
  readonly sourceDependency?: IconId;
}

export type PartProvenance = SourcePartProvenance | ModelPartProvenance | RecipePartProvenance;

export interface GlyphPart {
  readonly id: string;
  readonly role: PartRole;
  readonly zIndex: number;
  readonly d: string;
  /** null означает: часть имеет смысл только внутри GlyphIR.composition. */
  readonly fillRule: FillRule | null;
  readonly paint: RecipeFillPaint | RecipeStrokePaint;
  /** Нормализованный якорь в долях viewBox, а не экранные пиксели. */
  readonly anchor: readonly [number, number];
  readonly anchorSource: 'declared' | 'geometry-bbox-center';
  readonly topologySignature: string;
  readonly morphGroup: string | null;
  readonly provenance: PartProvenance;
}

export interface SourceGlyphProvenance {
  readonly kind: 'source';
  readonly file: string;
}

export interface ModelGlyphProvenance {
  readonly kind: 'model';
  readonly declaration: IconId;
  readonly archetype: string;
  readonly state: ModelState;
  /** Эффективные значения только реально поддержанных моделью осей. */
  readonly axes: Readonly<Partial<Record<AxisName, number>>>;
}

export interface RecipeGlyphProvenance {
  readonly kind: 'recipe';
  readonly recipe: string;
  readonly state: 'candidate';
  readonly sourceDependencies: readonly IconId[];
  readonly axes: Readonly<{ opsz: number }>;
  readonly context: Readonly<{
    day: number;
    epochMilliseconds: number;
    timeZone: string;
  }>;
}

export type GlyphProvenance = SourceGlyphProvenance | ModelGlyphProvenance | RecipeGlyphProvenance;

export interface GlyphIR {
  readonly icon: IconId;
  readonly variant: IconVariant;
  readonly viewBox: readonly [number, number, number, number];
  readonly parts: readonly GlyphPart[];
  /** Удобная сборка геометрии; способ paint задаёт composition, не порядок parts. */
  readonly d: string;
  readonly svg: string;
  readonly composition: GlyphComposition;
  readonly provenance: GlyphProvenance;
}

export type GlyphComposition =
  | Readonly<{ kind: 'layers' }>
  | Readonly<{ kind: 'compound'; fillRule: FillRule }>
  | Readonly<{
      kind: 'mask-subtract';
      basePartIds: readonly string[];
      subtractPartIds: readonly string[];
    }>;

export interface GlyphCapabilities {
  readonly icon: IconId;
  readonly variant: IconVariant;
  readonly modelState: ModelState | null;
  readonly supportedAxes: readonly AxisName[];
  readonly axes: Readonly<Partial<Record<AxisName, AxisContract>>>;
}

export interface AxisContract {
  readonly kind: 'continuous';
  readonly min: number;
  readonly default: number;
  readonly max: number;
  readonly lifecycle: string;
}

interface SourcePartContract {
  readonly id: string;
  readonly identity: 'geometry-derived';
  readonly role: 'unclassified';
  readonly zIndex: number;
  readonly fillRule: FillRule;
  readonly topologySignature: string;
  readonly sourceFingerprint: `sha256:${string}`;
  readonly artifactFingerprint: `sha256:${string}`;
}

interface SourceVariantContract {
  readonly file: string;
  readonly parts: readonly SourcePartContract[];
}

interface ModelPartContract {
  readonly id: string;
  readonly identity: 'declared';
  readonly role: PartRole;
  readonly zIndex: number;
  readonly anchor: readonly [number, number];
  readonly anchorSource: string;
  readonly morphGroup: string | null;
  readonly topologySignature: string;
}

interface ModelVariantContract {
  readonly state: ModelState;
  readonly supportedAxes: readonly AxisName[];
  readonly composition: Readonly<{ kind: 'compound'; fillRule: FillRule }>;
  readonly parts: readonly ModelPartContract[];
}

interface ModelContract {
  readonly declaration: IconId;
  readonly archetype: string;
  readonly variants: Readonly<Partial<Record<IconVariant, ModelVariantContract>>>;
}

interface IconContract {
  readonly source: Readonly<Record<IconVariant, SourceVariantContract>>;
  readonly model: ModelContract | null;
}

interface CatalogContract {
  readonly canvas: {
    readonly viewBox: readonly [number, number, number, number];
  };
  readonly axes: Readonly<Record<AxisName, AxisContract>>;
  readonly icons: Readonly<Record<IconId, IconContract>>;
}

interface BuiltPart {
  readonly id: string;
  readonly role: PartRole;
  readonly d: string;
  readonly zIndex: number;
  readonly anchor: readonly [number, number];
  readonly morphGroup: string | null;
  readonly topologySignature: string;
}

interface RenderedPathEntry {
  readonly index: number;
  readonly d: string;
  readonly fillRule: FillRule;
}

interface PathBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const catalog = catalogJson as unknown as CatalogContract;
const anatomy = anatomyJson as unknown as {
  readonly glyphs: Readonly<Record<string, unknown>>;
};
const grid = gridJson as unknown;

const VARIANTS = new Set<IconVariant>(['outline', 'filled']);
const MODEL_MODES = new Set<ModelMode>([
  'accepted-only',
  'allow-candidate',
  'source-only',
]);
const REQUEST_KEYS = new Set(['icon', 'variant', 'modelMode', 'axes']);

const catalogIconIds = Object.keys(catalog.icons).sort();
if (
  catalogIconIds.length !== ICON_IDS.length ||
  catalogIconIds.some((icon, index) => icon !== ICON_IDS[index])
) {
  throw new Error('@labpics/icons/ir: type-проекция IconId отстала от каталога');
}
const catalogAxisNames = Object.keys(catalog.axes).sort();
if (
  catalogAxisNames.length !== AXIS_NAMES.length ||
  catalogAxisNames.some((axis, index) => axis !== AXIS_NAMES[index])
) {
  throw new Error('@labpics/icons/ir: type-проекция AxisName отстала от каталога');
}

// `readonly` в .d.ts не защищает runtime-массив. Публичные перечисления —
// capability contract, поэтому отдаём отдельные frozen snapshots.
export const iconIds: readonly IconId[] = Object.freeze([...ICON_IDS]);
export const axisNames: readonly AxisName[] = Object.freeze([...AXIS_NAMES]);
export const axisContracts: Readonly<Record<AxisName, AxisContract>> = Object.freeze(
  Object.fromEntries(AXIS_NAMES.map((name) => [
    name,
    Object.freeze({ ...catalog.axes[name] }),
  ])) as Record<AxisName, AxisContract>,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isIconId(value: unknown): value is IconId {
  return typeof value === 'string' && Object.hasOwn(catalog.icons, value);
}

export function parseIconId(value: unknown): IconId {
  if (!isIconId(value)) {
    throw new TypeError(`@labpics/icons/ir: неизвестная иконка «${String(value)}»`);
  }
  return value;
}

function parseVariant(value: unknown): IconVariant {
  if (typeof value !== 'string' || !VARIANTS.has(value as IconVariant)) {
    throw new TypeError(
      `@labpics/icons/ir: variant обязан быть outline или filled, получено «${String(value)}»`,
    );
  }
  return value as IconVariant;
}

function parseModelMode(value: unknown): ModelMode {
  if (typeof value !== 'string' || !MODEL_MODES.has(value as ModelMode)) {
    throw new TypeError(
      `@labpics/icons/ir: неизвестный modelMode «${String(value)}»`,
    );
  }
  return value as ModelMode;
}

function parseAxes(value: unknown): Readonly<Partial<Record<AxisName, number>>> {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value)) {
    throw new TypeError('@labpics/icons/ir: axes обязан быть объектом');
  }

  const parsed: Partial<Record<AxisName, number>> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    if (!Object.hasOwn(catalog.axes, rawName)) {
      throw new TypeError(`@labpics/icons/ir: неизвестная ось «${rawName}»`);
    }
    const name = rawName as AxisName;
    const axis = catalog.axes[name];
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw new TypeError(`@labpics/icons/ir: ось ${name} обязана быть конечным числом`);
    }
    if (rawValue < axis.min || rawValue > axis.max) {
      throw new RangeError(
        `@labpics/icons/ir: ось ${name}=${rawValue} вне диапазона [${axis.min}, ${axis.max}]`,
      );
    }
    parsed[name] = rawValue;
  }
  return Object.freeze(parsed);
}

/**
 * Единственная граница для недоверенного JSON/DOM-ввода. После неё неверные
 * variant/modelMode/axes уже не представлены в функциональном ядре.
 */
export function parseGlyphRequest(value: unknown): ParsedGlyphRequest {
  if (!isRecord(value)) {
    throw new TypeError('@labpics/icons/ir: запрос обязан быть объектом');
  }
  const unknownKeys = Object.keys(value).filter((key) => !REQUEST_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(
      `@labpics/icons/ir: неизвестные поля запроса: ${unknownKeys.join(', ')}`,
    );
  }
  return Object.freeze({
    icon: parseIconId(value.icon),
    variant: value.variant === undefined ? 'outline' : parseVariant(value.variant),
    modelMode:
      value.modelMode === undefined
        ? 'accepted-only'
        : parseModelMode(value.modelMode),
    axes: parseAxes(value.axes),
  });
}

function exportName(icon: IconId, variant: IconVariant): string {
  const camel = icon.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
  return `${camel}${variant === 'outline' ? 'Outline' : 'Filled'}`;
}

function sourceSvg(icon: IconId, variant: IconVariant): string {
  const name = exportName(icon, variant);
  const value = (staticIcons as Readonly<Record<string, unknown>>)[name];
  if (typeof value !== 'string') {
    throw new Error(`@labpics/icons/ir: статический экспорт ${name} отсутствует`);
  }
  return value;
}

function normalizedAnchor(
  d: string,
  viewBox: readonly [number, number, number, number],
): readonly [number, number] {
  const bounds = pathBBox(d) as PathBounds;
  const [x, y, width, height] = viewBox;
  if (!(width > 0 && height > 0)) {
    throw new Error('@labpics/icons/ir: viewBox обязан иметь положительный размер');
  }
  return Object.freeze([
    ((bounds.minX + bounds.maxX) / 2 - x) / width,
    ((bounds.minY + bounds.maxY) / 2 - y) / height,
  ] as const);
}

function sourceParts(
  icon: IconId,
  variant: IconVariant,
  contract: SourceVariantContract,
): readonly GlyphPart[] {
  const entries = sourcePathEntries(sourceSvg(icon, variant)) as RenderedPathEntry[];
  if (entries.length !== contract.parts.length) {
    throw new Error(
      `@labpics/icons/ir: drift source ${icon}/${variant}: ` +
        `${entries.length} paths вместо ${contract.parts.length}`,
    );
  }

  return Object.freeze(entries.map((entry, index): GlyphPart => {
    const part = contract.parts[index];
    if (!part || part.zIndex !== index || entry.index !== index) {
      throw new Error(`@labpics/icons/ir: нарушен z-order source ${icon}/${variant}`);
    }
    if (entry.fillRule !== part.fillRule) {
      throw new Error(
        `@labpics/icons/ir: drift fill-rule ${icon}/${variant}/${part.id}`,
      );
    }
    const topologySignature = computeTopologySignature(entry.d) as string;
    const artifactFingerprint = `sha256:${sha256Hex(
      `${entry.fillRule}\0${JSON.stringify(parsePathData(entry.d))}`,
    )}` as const;
    if (artifactFingerprint !== part.artifactFingerprint) {
      throw new Error(`@labpics/icons/ir: fingerprint drift ${icon}/${variant}/${part.id}`);
    }
    return Object.freeze({
      id: part.id,
      role: part.role,
      zIndex: part.zIndex,
      d: entry.d,
      fillRule: entry.fillRule,
      paint: Object.freeze({ kind: 'fill', fill: 'currentColor' }),
      anchor: normalizedAnchor(entry.d, catalog.canvas.viewBox),
      anchorSource: 'geometry-bbox-center',
      topologySignature,
      morphGroup: null,
      provenance: Object.freeze({
        kind: 'source',
        identity: part.identity,
        file: contract.file,
        sourceFingerprint: part.sourceFingerprint,
        artifactFingerprint,
      }),
    });
  }));
}

function effectiveAxes(
  model: ModelVariantContract,
  requested: Readonly<Partial<Record<AxisName, number>>>,
): Readonly<Partial<Record<AxisName, number>>> {
  const supported = new Set(model.supportedAxes);
  for (const name of Object.keys(requested) as AxisName[]) {
    if (!supported.has(name)) {
      throw new RangeError(
        `@labpics/icons/ir: модель не поддерживает ось ${name}`,
      );
    }
  }
  const resolved: Partial<Record<AxisName, number>> = {};
  for (const name of model.supportedAxes) {
    resolved[name] = requested[name] ?? catalog.axes[name].default;
  }
  return Object.freeze(resolved);
}

function modelParts(
  icon: IconId,
  variant: IconVariant,
  contract: ModelContract,
  model: ModelVariantContract,
  axes: Readonly<Partial<Record<AxisName, number>>>,
): readonly GlyphPart[] {
  const declaration = anatomy.glyphs[contract.declaration];
  if (!declaration) {
    throw new Error(
      `@labpics/icons/ir: anatomy-декларация ${contract.declaration} отсутствует`,
    );
  }
  const generated = buildAnatomyParts(
    declaration,
    grid,
    axes,
    anatomy.glyphs,
  ) as Partial<Record<IconVariant, BuiltPart[]>>;
  const parts = generated[variant];
  if (!parts || parts.length !== model.parts.length) {
    throw new Error(`@labpics/icons/ir: drift модели ${icon}/${variant}`);
  }
  return Object.freeze(model.parts.map((part, index): GlyphPart => {
    const built = parts[index];
    if (
      !built ||
      built.id !== part.id ||
      built.zIndex !== part.zIndex ||
      built.role !== part.role ||
      built.topologySignature !== part.topologySignature
    ) {
      throw new Error(
        `@labpics/icons/ir: drift части модели ${icon}/${variant}/${part.id}`,
      );
    }
    if (
      axes &&
      model.supportedAxes.every((axis) => axes[axis] === catalog.axes[axis].default) &&
      (Math.abs(built.anchor[0] - part.anchor[0]) > 1e-6 ||
        Math.abs(built.anchor[1] - part.anchor[1]) > 1e-6)
    ) {
      throw new Error(`@labpics/icons/ir: drift anchor ${icon}/${variant}/${part.id}`);
    }
    return Object.freeze({
      id: part.id,
      role: part.role,
      zIndex: part.zIndex,
      d: built.d,
      // Отдельная часть compound-модели не имеет самостоятельного fill rule:
      // cog/tablet доказывают, что присвоить здесь nonzero — публичная ложь.
      fillRule: null,
      paint: Object.freeze({ kind: 'fill', fill: 'currentColor' }),
      anchor: Object.freeze([built.anchor[0], built.anchor[1]] as const),
      anchorSource: part.anchorSource as 'declared' | 'geometry-bbox-center',
      // Непрерывные model axes обязаны сохранять command topology. Дискретные
      // optical masters живут в recipe-контрактах, а не маскируются здесь.
      topologySignature: built.topologySignature,
      morphGroup: part.morphGroup,
      provenance: Object.freeze({
        kind: 'model',
        identity: part.identity,
        declaration: contract.declaration,
        state: model.state,
      }),
    });
  }));
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function stableSvgId(value: string): string {
  // DOM id участвует в реальной render-семантике: два разных mask с одним id
  // в общем документе могут разрешить url(#id) к чужой геометрии. 32-bit FNV
  // действительно столкнулся на двух допустимых calendar opsz; используем уже
  // проверенный синхронный SHA-256 целиком, а не вероятностный короткий hash.
  return `lab-icons-mask-${sha256Hex(value)}`;
}

function assembleSvg(
  viewBox: readonly [number, number, number, number],
  parts: readonly GlyphPart[],
  composition: GlyphComposition,
): string {
  const pathForPart = (part: GlyphPart, color = 'currentColor') => {
    const paint = part.paint.kind === 'fill'
      ? `fill="${color}"`
      : `fill="none" stroke="${color}" stroke-width="${part.paint.strokeWidth}" ` +
        `stroke-linecap="${part.paint.linecap}" stroke-linejoin="${part.paint.linejoin}"`;
    const fillRule = part.fillRule == null ? '' : ` fill-rule="${part.fillRule}"`;
    return `<path data-part="${escapeAttribute(part.id)}" ` +
      `data-role="${escapeAttribute(part.role)}" ${paint} ` +
      `${fillRule} d="${escapeAttribute(part.d)}"/>`;
  };
  let paths: string;
  if (composition.kind === 'layers') {
    if (parts.some((part) => part.fillRule == null)) {
      throw new Error('@labpics/icons/ir: layer обязан иметь самостоятельный fillRule');
    }
    paths = parts.map((part) => pathForPart(part)).join('');
  } else if (composition.kind === 'compound') {
    paths = (() => {
        if (parts.some((part) => part.paint.kind !== 'fill')) {
          throw new Error('@labpics/icons/ir: compound composition пока допускает только fill outlines');
        }
        const ids = parts.map((part) => part.id).join(' ');
        const roles = parts.map((part) => part.role).join(' ');
        return `<path data-parts="${escapeAttribute(ids)}" ` +
          `data-roles="${escapeAttribute(roles)}" fill="currentColor" ` +
          `fill-rule="${composition.fillRule}" d="${escapeAttribute(parts.map((part) => part.d).join(''))}"/>`;
      })();
  } else {
    const byId = new Map(parts.map((part) => [part.id, part]));
    const ids = [...composition.basePartIds, ...composition.subtractPartIds];
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== parts.length ||
      ids.some((id) => !byId.has(id))
    ) {
      throw new Error('@labpics/icons/ir: mask-subtract обязан классифицировать каждую часть ровно один раз');
    }
    const base = composition.basePartIds.map((id) => byId.get(id)!);
    const subtract = composition.subtractPartIds.map((id) => byId.get(id)!);
    const [x, y, width, height] = viewBox;
    const maskBody =
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#000"/>` +
      base.map((part) => pathForPart(part, '#fff')).join('') +
      subtract.map((part) => pathForPart(part, '#000')).join('');
    const visibleBody = base.map((part) => pathForPart(part)).join('');
    // Hash exactly the render-relevant mask payload, including viewport and
    // base/subtract classification. Hashing only d/strokeWidth would let a
    // future composition change reuse an id for different DOM semantics.
    const maskId = stableSvgId(`${viewBox.join(' ')}\0${maskBody}\0${visibleBody}`);
    paths = `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" ` +
      `x="${x}" y="${y}" width="${width}" height="${height}" mask-type="luminance">` +
      `${maskBody}</mask></defs><g mask="url(#${maskId})">${visibleBody}</g>`;
  }
  return (
    `<svg viewBox="${viewBox.join(' ')}" xmlns="http://www.w3.org/2000/svg" ` +
    `width="${viewBox[2]}" height="${viewBox[3]}" fill="currentColor">${paths}</svg>`
  );
}

function modelAllowed(model: ModelVariantContract, mode: ModelMode): boolean {
  if (mode === 'source-only') return false;
  if (model.state === 'accepted') return true;
  return mode === 'allow-candidate';
}

/** Состояние модели читается без её построения и без побочных эффектов. */
export function glyphCapabilities(
  iconValue: unknown,
  variantValue: unknown = 'outline',
): GlyphCapabilities {
  const icon = parseIconId(iconValue);
  const variant = parseVariant(variantValue);
  const model = catalog.icons[icon].model?.variants[variant];
  const supportedAxes = Object.freeze([...(model?.supportedAxes ?? [])]);
  return Object.freeze({
    icon,
    variant,
    modelState: model?.state ?? null,
    supportedAxes,
    axes: Object.freeze(Object.fromEntries(
      supportedAxes.map((name) => [name, axisContracts[name]]),
    )),
  });
}

/**
 * Строит воспроизводимый Glyph IR. При недоступной в выбранном режиме модели
 * запрос без осей получает точный source fallback; оси никогда не теряются
 * молча и в таком случае приводят к ошибке.
 */
export function glyph(request: GlyphRequest): GlyphIR;
export function glyph(request: unknown): GlyphIR {
  const parsed = parseGlyphRequest(request);
  const iconContract = catalog.icons[parsed.icon];
  const modelContract = iconContract.model;
  const model = modelContract?.variants[parsed.variant];

  let parts: readonly GlyphPart[];
  let provenance: GlyphProvenance;
  let composition: GlyphComposition;

  if (modelContract && model && modelAllowed(model, parsed.modelMode)) {
    const axes = effectiveAxes(model, parsed.axes);
    parts = modelParts(
      parsed.icon,
      parsed.variant,
      modelContract,
      model,
      axes,
    );
    provenance = Object.freeze({
      kind: 'model',
      declaration: modelContract.declaration,
      archetype: modelContract.archetype,
      state: model.state,
      axes,
    });
    composition = Object.freeze({ ...model.composition });
  } else {
    const requestedAxes = Object.keys(parsed.axes);
    if (requestedAxes.length > 0) {
      throw new RangeError(
        `@labpics/icons/ir: ${parsed.icon}/${parsed.variant} не имеет ` +
          `разрешённой модели для осей ${requestedAxes.join(', ')}`,
      );
    }
    const source = iconContract.source[parsed.variant];
    parts = sourceParts(parsed.icon, parsed.variant, source);
    provenance = Object.freeze({ kind: 'source', file: source.file });
    composition = Object.freeze({ kind: 'layers' });
  }

  const d = parts.map((part) => part.d).join('');
  return Object.freeze({
    icon: parsed.icon,
    variant: parsed.variant,
    viewBox: Object.freeze([...catalog.canvas.viewBox]) as unknown as readonly [
      number,
      number,
      number,
      number,
    ],
    parts,
    d,
    svg: assembleSvg(catalog.canvas.viewBox, parts, composition),
    composition,
    provenance,
  });
}

export interface CalendarNumberGlyphInput extends Omit<CalendarNumberInput, 'aperture'> {
  readonly variant?: IconVariant;
}

const CALENDAR_SHELL_CONTRACT = Object.freeze({
  outline: Object.freeze({
    dependency: 'calendar-number' as IconId,
    // Geometry fingerprint из canonical catalog: любое редактирование shell
    // требует осознанно перепривязать recipe вместо выбора «самого большого» path.
    sourcePartId: 'source-c18fd85190d3',
  }),
  filled: Object.freeze({
    dependency: 'calendar-clear' as IconId,
    sourcePartId: 'source-87d6cad16173',
  }),
});

/**
 * Динамический calendar-number: точная shell-геометрия корпуса + собственные
 * tabular digits. Функция ничего не планирует и не читает часы сама.
 */
export function calendarNumberGlyph(input: CalendarNumberGlyphInput): GlyphIR {
  if (!isRecord(input)) throw new TypeError('@labpics/icons/ir: calendar input обязан быть объектом');
  const allowed = new Set(['date', 'timeZone', 'opsz', 'variant']);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`@labpics/icons/ir: неизвестные calendar поля: ${unknown.join(', ')}`);
  }
  const variant = input.variant === undefined ? 'outline' : parseVariant(input.variant);
  const number = buildCalendarNumberRecipe({
    date: input.date,
    timeZone: input.timeZone,
    opsz: input.opsz,
  });

  // Outline calendar-number уже несёт точную shell отдельным path. В Filled
  // чистая shell без старых «31» — единственный path calendar-clear.
  const shellContract = CALENDAR_SHELL_CONTRACT[variant];
  const dependency = shellContract.dependency;
  const source = sourceParts(
    dependency,
    variant,
    catalog.icons[dependency].source[variant],
  );
  const shellSource = source.find((part) => part.id === shellContract.sourcePartId);
  if (!shellSource) {
    throw new Error(`@labpics/icons/ir: shell contract ${dependency}/${variant} дрейфует`);
  }

  const shell: GlyphPart = Object.freeze({
    id: 'calendar.shell',
    role: 'container',
    zIndex: 0,
    d: shellSource.d,
    fillRule: shellSource.fillRule,
    paint: Object.freeze({ kind: 'fill', fill: 'currentColor' }),
    anchor: Object.freeze([0.5, 0.5] as const),
    anchorSource: 'declared',
    topologySignature: shellSource.topologySignature,
    morphGroup: null,
    provenance: Object.freeze({
      kind: 'recipe',
      identity: 'declared',
      recipe: 'calendar-number-v1',
      sourceDependency: dependency,
    }),
  });

  const digitParts: GlyphPart[] = number.parts.map((part) => Object.freeze({
    id: part.id,
    role: 'content',
    zIndex: part.slot === 'tens' ? 1 : 2,
    d: part.d,
    fillRule: 'nonzero',
    paint: Object.freeze({
      kind: 'stroke',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: part.paint.strokeWidth,
      linecap: 'round',
      linejoin: 'round',
    }),
    anchor: Object.freeze([
      part.cell.centerX / catalog.canvas.viewBox[2],
      part.cell.centerY / catalog.canvas.viewBox[3],
    ] as const),
    anchorSource: 'declared',
    topologySignature: part.topologySignature,
    // Совпадение slot identity не доказывает point correspondence цифр.
    // До явного remap морф-группа намеренно отсутствует.
    morphGroup: null,
    provenance: Object.freeze({
      kind: 'recipe',
      identity: 'declared',
      recipe: 'calendar-rounded-16-48-v1',
    }),
  }));
  const parts = Object.freeze([shell, ...digitParts]);
  const composition: GlyphComposition = variant === 'outline'
    ? Object.freeze({ kind: 'layers' })
    : Object.freeze({
        kind: 'mask-subtract',
        basePartIds: Object.freeze(['calendar.shell']),
        subtractPartIds: Object.freeze(digitParts.map((part) => part.id)),
      });
  const viewBox = Object.freeze([...catalog.canvas.viewBox]) as unknown as readonly [
    number,
    number,
    number,
    number,
  ];
  return Object.freeze({
    icon: 'calendar-number',
    variant,
    viewBox,
    parts,
    d: parts.map((part) => part.d).join(''),
    svg: assembleSvg(viewBox, parts, composition),
    composition,
    provenance: Object.freeze({
      kind: 'recipe',
      recipe: 'calendar-number-v1',
      state: 'candidate',
      sourceDependencies: Object.freeze([dependency]),
      axes: Object.freeze({ opsz: number.axis.opsz }),
      context: Object.freeze({
        day: number.day,
        epochMilliseconds: number.epochMilliseconds,
        timeZone: number.timeZone,
      }),
    }),
  });
}
