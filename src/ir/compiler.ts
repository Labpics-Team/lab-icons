/**
 * Публичный Glyph IR: строгая граница между точным SVG-источником и
 * доказанной параметрической моделью. Модуль не читает файлы, часы и DOM:
 * все данные попадают в браузер как статические импорты сборщика.
 */

// Чистые внутренние JS-модули подключаются через типизированную границу.
// Их нестрогие типы не передаются потребителю публичного API.
// @ts-expect-error — Внутренний JS-модуль не имеет отдельной декларации типов.
import { buildGlyphParts as buildAnatomyParts, topologySignature as computeTopologySignature } from '../core/anatomy-gen.js';
// @ts-expect-error — см. комментарий выше; функция чистая и bundleable.
import { sourcePathEntries } from '../core/icon-geometry.js';
// @ts-expect-error — см. комментарий выше; функция чистая и bundleable.
import { parsePathData, pathBBox } from '../core/path-data.js';
// @ts-expect-error — build-only JS helper использует тот же canonical parser.
import { closedSourceContourLiterals } from '../core/source-contours.js';
import { sampleMotionGesture as sampleMotionGestureCore } from '../core/motion-sampler.js';
import {
  buildCalendarNumberGeometry as buildCalendarNumberRecipe,
  type CalendarNumberInput,
} from './recipes.js';
import { sha256Hex } from './sha256.js';
import { assembleGlyphSvg as assembleSvg } from './svg-assembly.js';
import { GlyphModelError, parseSymbolOptions, parseSymbolVariant as parseVariant } from './request.js';
import type { AuthorAnatomyReceipt } from './author-provenance.js';
import type * as IR from './glyph-types.js';
export type { IconId, AxisName, IconVariant, ModelMode, ModelState, FillRule, PartRole, GlyphRequest, SourcePartProvenance, ModelPartProvenance, RecipePartProvenance, PartProvenance, GlyphPart, SourceGlyphProvenance, ModelGlyphProvenance, RecipeGlyphProvenance, DesignSpecGlyphProvenance, GlyphProvenance, GlyphIR, GlyphComposition, GlyphCapabilities, AxisContract, MotionCapabilityState, MotionGestureRotationTrackContract, MotionGestureOpacityTrackContract, MotionGestureTranslationTrackContract, MotionGestureTrackContract, MotionGestureContract, MotionGestureRotationSample, MotionGestureSample, MotionRotationTrackContract, MotionTrackContract, MotionCapabilities } from './glyph-types.js';
export { GlyphModelError } from './request.js';
export type { GlyphModelErrorCode } from './request.js';

export interface ParsedGlyphRequest<TIcon extends string = IR.IconId> {
  readonly icon: TIcon;
  readonly variant: IR.IconVariant;
  readonly modelMode: IR.ModelMode;
  readonly axes: IR.AxisValues;
}

function cloneGlyphComposition(composition: IR.GlyphComposition): IR.GlyphComposition {
  if (composition.kind === 'layers') {
    return Object.freeze({ kind: 'layers' });
  }
  if (composition.kind === 'compound') {
    return Object.freeze({ kind: 'compound', fillRule: composition.fillRule });
  }
  return Object.freeze({
    kind: 'mask-subtract',
    basePartIds: Object.freeze([...composition.basePartIds]),
    subtractPartIds: Object.freeze([...composition.subtractPartIds]),
  });
}

export function sampleMotionGesture(
  gesture: IR.MotionGestureContract,
  progress: number,
): readonly IR.MotionGestureSample[] {
  return sampleMotionGestureCore(gesture, progress);
}

export interface IconDesignContract {
  readonly version: 1;
  readonly canvas: Readonly<{
    readonly viewBox: readonly [number, number, number, number];
    readonly declarationUnits: 'fraction-of-canvas';
  }>;
  readonly variants: readonly IR.IconVariant[];
  readonly source: Readonly<{
    readonly paint: 'currentColor';
    readonly geometry: 'path-only';
    readonly intake: 'figma-import';
  }>;
  readonly constraints: Readonly<{
    readonly margin: number;
    readonly clearanceMin: number;
    readonly opticalCenterBias: number;
    readonly angleScale: readonly number[];
  }>;
  readonly axes: Readonly<Record<IR.AxisName, IR.AxisContract>>;
  readonly lifecycle: Readonly<{
    readonly sourceOnly: 'exact-source-fallback';
    readonly candidate: 'research-only';
    readonly accepted: 'public-after-proof';
  }>;
  readonly targets: Readonly<{
    readonly staticSvg: 'supported';
    readonly glyphIr: 'supported';
    readonly lottie: 'not-exported';
    readonly sfSymbols: 'not-exported';
  }>;
  readonly agent: Readonly<{
    readonly proposalCommand: 'pnpm validate:proposal';
    readonly promotionCommand: 'pnpm import:figma --write';
    readonly finalGate: 'pnpm verify';
  }>;
}

interface SourcePartContract {
  readonly id: string;
  readonly identity: 'geometry-derived' | 'declared';
  readonly role: IR.PartRole;
  readonly anchor?: readonly [number, number];
  readonly anchorSource?: 'declared';
  readonly zIndex: number;
  readonly fillRule: IR.FillRule | null;
  readonly contourIndices?: readonly number[];
  readonly topologySignature: string;
  readonly sourceFingerprint: `sha256:${string}`;
  readonly artifactFingerprint: `sha256:${string}`;
}

interface SourceVariantContract {
  readonly file: string;
  readonly parts: readonly SourcePartContract[];
  readonly anatomy?: AuthorAnatomyReceipt;
  readonly gestures?: readonly IR.MotionGestureContract[];
  readonly composition?: Readonly<{ kind: 'compound'; fillRule: IR.FillRule }>;
}

interface ModelPartContract {
  readonly id: string;
  readonly identity: 'declared';
  readonly role: IR.PartRole;
  readonly zIndex: number;
  readonly anchor: readonly [number, number];
  readonly anchorSource: string;
  readonly morphGroup: string | null;
  readonly topologySignature: string;
}

interface ModelVariantContract {
  readonly state: IR.ModelState;
  readonly supportedAxes: readonly IR.AxisName[];
  readonly composition: IR.GlyphComposition;
  readonly parts: readonly ModelPartContract[];
}

interface ModelContract {
  readonly declaration: IR.IconId;
  readonly archetype: string;
  readonly variants: Readonly<Partial<Record<IR.IconVariant, ModelVariantContract>>>;
}

interface IconContract {
  readonly source: Readonly<Record<IR.IconVariant, SourceVariantContract>>;
  readonly model: ModelContract | null;
}

interface CatalogContract {
  readonly canvas: {
    readonly viewBox: readonly [number, number, number, number];
  };
  readonly axes: Readonly<Record<IR.AxisName, IR.AxisContract>>;
  readonly icons: Readonly<Record<IR.IconId, IconContract>>;
}

interface BuiltPart {
  readonly id: string;
  readonly role: IR.PartRole;
  readonly d: string;
  readonly zIndex: number;
  readonly anchor: readonly [number, number];
  readonly morphGroup: string | null;
  readonly topologySignature: string;
}

interface RenderedPathEntry {
  readonly index: number;
  readonly d: string;
  readonly fillRule: IR.FillRule;
}

interface PathBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface CalendarNumberGlyphInput extends Omit<CalendarNumberInput, 'aperture'> {
  readonly variant?: IR.IconVariant;
}

/** Контракт значений runtime; constructor и его входные данные остаются внутренними. */
export interface GlyphCompiler {
  readonly glyph: (request: IR.GlyphRequest) => IR.GlyphIR;
  readonly glyphCapabilities: (iconValue: unknown, variantValue?: unknown) => IR.GlyphCapabilities;
  readonly parseGlyphRequest: (value: unknown) => ParsedGlyphRequest;
  readonly parseIconId: (value: unknown) => IR.IconId;
  readonly isIconId: (value: unknown) => value is IR.IconId;
  readonly calendarNumberGlyph: (input: CalendarNumberGlyphInput) => IR.GlyphIR;
  readonly iconIds: readonly IR.IconId[];
  readonly axisNames: readonly IR.AxisName[];
  readonly axisContracts: Readonly<Record<IR.AxisName, IR.AxisContract>>;
  readonly iconDesignContract: IconDesignContract;
}

type AnatomyContract = {
  readonly glyphs: Readonly<Record<string, Readonly<{
    readonly status?: Readonly<Partial<Record<IR.IconVariant, string>>>;
    readonly motion?: Readonly<{
      readonly state?: string;
      readonly gestures?: readonly Readonly<Omit<IR.MotionGestureContract, 'tracks'> & {
        readonly tracks: readonly IR.MotionGestureRotationTrackContract[];
      }>[];
    }>;
    readonly parts?: readonly Readonly<{
      readonly id?: string;
      readonly primitive?: string;
      readonly anchor?: readonly [number, number];
    }>[];
   }>>>;
};
type AnatomyGlyph = AnatomyContract['glyphs'][string];
type CandidateVariantRegistration = `${string}/${IR.IconVariant}`;
type CandidateAnatomyRegistration = (glyphs: Readonly<Record<string, AnatomyGlyph>>, variants: readonly CandidateVariantRegistration[]) => void;

declare const sessionIdentity: unique symbol;
/** Entry point видит только опубликованные снимки, а не устройство реестра. */
interface GlyphCompilerSession extends Pick<GlyphCompiler, 'iconIds' | 'axisNames' | 'axisContracts' | 'iconDesignContract'> {
  readonly [sessionIdentity]: true;
}

interface GlyphCompilerState extends Pick<GlyphCompiler, 'iconIds' | 'axisNames' | 'axisContracts' | 'iconDesignContract'> {
  readonly catalog: CatalogContract;
  readonly anatomy: AnatomyContract;
  readonly grid: unknown;
  readonly staticIcons: Readonly<Record<string, unknown>>;
  readonly candidateGlyphs: Map<string, AnatomyGlyph>;
  readonly registeredCandidateVariants: Set<string>;
  readonly REQUEST_KEYS: Set<string>;
  readonly motionAdapters: Readonly<{ lottie: 'not-exported'; sfSymbols: 'not-exported' }>;
}

/** @internal Одна сессия владеет данными, снимками и реестром candidate-моделей. */
export function createGlyphCompilerSession({ catalog: catalogJson, anatomy: anatomyJson, grid: gridJson, staticIcons }: { catalog: unknown; anatomy: unknown; grid: unknown; staticIcons: Readonly<Record<string, unknown>> }): GlyphCompilerSession {
  const catalog = catalogJson as CatalogContract;
  const anatomy = anatomyJson as AnatomyContract;
  const candidateGlyphs = new Map<string, AnatomyGlyph>();
  const registeredCandidateVariants = new Set<string>();
  const designGrid = gridJson as unknown as Readonly<{
    canvas: Readonly<{ width: number; height: number }>;
    ratios: Readonly<{
      margin: number;
      clearanceMin: number;
      opticalCenterBias: number;
      angleScale: readonly number[];
    }>;
  }>;
  const grid = gridJson as unknown;

  const REQUEST_KEYS = new Set(['icon', 'variant', 'modelMode', 'axes']);

  const ICON_IDS = Object.keys(catalog.icons).sort() as IR.IconId[];
  const AXIS_NAMES = Object.keys(catalog.axes).sort() as IR.AxisName[];

  // `readonly` в .d.ts не защищает runtime-массив. Публичные перечисления —
  // capability contract, поэтому отдаём отдельные frozen snapshots.
  const iconIds: readonly IR.IconId[] = Object.freeze([...ICON_IDS]);
  const axisNames: readonly IR.AxisName[] = Object.freeze([...AXIS_NAMES]);
  const axisContracts: Readonly<Record<IR.AxisName, IR.AxisContract>> = Object.freeze(
    Object.fromEntries(AXIS_NAMES.map((name) => [
      name,
      Object.freeze({ ...catalog.axes[name] }),
    ])) as Record<IR.AxisName, IR.AxisContract>,
  );

  const motionAdapters = Object.freeze({
    lottie: 'not-exported',
    sfSymbols: 'not-exported',
  } as const);

  const iconDesignContract: IconDesignContract = Object.freeze({
    version: 1,
    canvas: Object.freeze({
      viewBox: Object.freeze([0, 0, designGrid.canvas.width, designGrid.canvas.height]) as unknown as readonly [
        number,
        number,
        number,
        number,
      ],
      declarationUnits: 'fraction-of-canvas',
    }),
    variants: Object.freeze(['outline', 'filled'] as const),
    source: Object.freeze({
      paint: 'currentColor',
      geometry: 'path-only',
      intake: 'figma-import',
    }),
    constraints: Object.freeze({
      margin: designGrid.ratios.margin,
      clearanceMin: designGrid.ratios.clearanceMin,
      opticalCenterBias: designGrid.ratios.opticalCenterBias,
      angleScale: Object.freeze([...designGrid.ratios.angleScale]),
    }),
    axes: axisContracts,
    lifecycle: Object.freeze({
      sourceOnly: 'exact-source-fallback',
      candidate: 'research-only',
      accepted: 'public-after-proof',
    }),
    targets: Object.freeze({
      staticSvg: 'supported',
      glyphIr: 'supported',
      lottie: 'not-exported',
      sfSymbols: 'not-exported',
    }),
    agent: Object.freeze({
      proposalCommand: 'pnpm validate:proposal',
      promotionCommand: 'pnpm import:figma --write',
      finalGate: 'pnpm verify',
    }),
  });

  return Object.freeze({ catalog, anatomy, grid, staticIcons, candidateGlyphs, registeredCandidateVariants,
    REQUEST_KEYS, iconIds, axisNames, axisContracts, motionAdapters, iconDesignContract }) as unknown as GlyphCompilerSession;
}

function anatomyGlyph(context: GlyphCompilerSession, name: string): AnatomyGlyph | undefined {
  const { anatomy, candidateGlyphs } = context as unknown as GlyphCompilerState;
  return anatomy.glyphs[name] ?? candidateGlyphs.get(name);
}

function anatomyLibrary(context: GlyphCompilerSession): Readonly<Record<string, AnatomyGlyph>> {
  const { anatomy, candidateGlyphs } = context as unknown as GlyphCompilerState;
  if (candidateGlyphs.size === 0) return anatomy.glyphs;
  return { ...Object.fromEntries(candidateGlyphs), ...anatomy.glyphs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function checkIconId(context: GlyphCompilerSession, value: unknown): value is IR.IconId {
  return typeof value === 'string' && Object.hasOwn((context as unknown as GlyphCompilerState).catalog.icons, value);
}

export function parseIconIdValue(context: GlyphCompilerSession, value: unknown): IR.IconId {
  if (!checkIconId(context, value)) {
    throw new TypeError(`@labpics/icons/ir: неизвестная иконка «${String(value)}»`);
  }
  return value;
}

/**
 * Единственная граница для недоверенного JSON/DOM-ввода. После неё неверные
 * variant/modelMode/axes уже не представлены в функциональном ядре.
 */
export function parseGlyphRequestValue(context: GlyphCompilerSession, value: unknown): ParsedGlyphRequest {
  const { catalog, REQUEST_KEYS } = context as unknown as GlyphCompilerState;
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
    icon: parseIconIdValue(context, value.icon),
    ...parseSymbolOptions({ variant: value.variant, modelMode: value.modelMode, axes: value.axes }, catalog.axes),
  });
}

function exportName(icon: IR.IconId, variant: IR.IconVariant): string {
  const camel = icon.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
  return `${camel}${variant === 'outline' ? 'Outline' : 'Filled'}`;
}

function sourceSvg(context: GlyphCompilerSession, icon: IR.IconId, variant: IR.IconVariant): string {
  const { staticIcons } = context as unknown as GlyphCompilerState;
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
  context: GlyphCompilerSession,
  icon: IR.IconId,
  variant: IR.IconVariant,
  contract: SourceVariantContract,
): readonly IR.GlyphPart[] {
  const { catalog } = context as unknown as GlyphCompilerState;
  const parents = sourcePathEntries(sourceSvg(context, icon, variant)) as RenderedPathEntry[];
  let entries: readonly Readonly<{ index: number; d: string; fillRule: IR.FillRule | null }>[] = parents;
  if (contract.composition) {
    if (contract.composition.kind !== 'compound' || contract.composition.fillRule !== 'evenodd' ||
        parents.length !== 1 || parents[0]!.fillRule !== contract.composition.fillRule || !contract.anatomy ||
        sha256Hex(JSON.stringify(parents.map(entry => ({ d: entry.d, fillRule: entry.fillRule, index: entry.index })))) !==
          contract.anatomy.pathFingerprintSha256) {
      throw new Error(`@labpics/icons/ir: drift compound parent ${icon}/${variant}`);
    }
    const literals = closedSourceContourLiterals(parents[0]!.d) as string[];
    if (contract.parts.length !== literals.length || contract.parts.some((part, index) =>
        part.contourIndices?.length !== 1 || part.contourIndices[0] !== index || part.fillRule !== null)) {
      throw new Error(`@labpics/icons/ir: drift compound contour coverage ${icon}/${variant}`);
    }
    entries = literals.map((d, index) => ({ index, d, fillRule: null }));
  }
  if (entries.length !== contract.parts.length) {
    throw new Error(
      `@labpics/icons/ir: drift source ${icon}/${variant}: ` +
        `${entries.length} paths вместо ${contract.parts.length}`,
    );
  }

  return Object.freeze(entries.map((entry, index): IR.GlyphPart => {
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
      anchor: part.anchor && contract.anatomy
        ? Object.freeze([...part.anchor] as [number, number])
        : normalizedAnchor(entry.d, catalog.canvas.viewBox),
      anchorSource: part.anchor && contract.anatomy ? 'declared' : 'geometry-bbox-center',
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
  context: GlyphCompilerSession,
  model: ModelVariantContract,
  requested: Readonly<Partial<Record<IR.AxisName, number>>>,
): Readonly<Partial<Record<IR.AxisName, number>>> {
  const { catalog } = context as unknown as GlyphCompilerState;
  const supported = new Set(model.supportedAxes);
  for (const name of Object.keys(requested) as IR.AxisName[]) {
    if (!supported.has(name)) {
      throw new RangeError(
        `@labpics/icons/ir: модель не поддерживает ось ${name}`,
      );
    }
  }
  const resolved: Partial<Record<IR.AxisName, number>> = {};
  for (const name of model.supportedAxes) {
    resolved[name] = requested[name] ?? catalog.axes[name].default;
  }
  return Object.freeze(resolved);
}

function modelParts(
  context: GlyphCompilerSession,
  icon: IR.IconId,
  variant: IR.IconVariant,
  contract: ModelContract,
  model: ModelVariantContract,
  composition: IR.GlyphComposition,
  axes: Readonly<Partial<Record<IR.AxisName, number>>>,
): readonly IR.GlyphPart[] {
  const { catalog, grid } = context as unknown as GlyphCompilerState;
  const declaration = anatomyGlyph(context, contract.declaration);
  if (!declaration) {
    throw new GlyphModelError(
      'CANDIDATES_REQUIRED',
      `@labpics/icons/ir: anatomy-декларация ${contract.declaration} не входит в runtime-проекцию; ` +
        `candidate-модели подключаются через @labpics/icons/ir/candidates (registerCandidates)`,
    );
  }
  const generated = buildAnatomyParts(
    declaration,
    grid,
    axes,
    anatomyLibrary(context),
  ) as Partial<Record<IR.IconVariant, BuiltPart[]>>;
  const parts = generated[variant];
  if (!parts || parts.length !== model.parts.length) {
    throw new Error(`@labpics/icons/ir: drift модели ${icon}/${variant}`);
  }
  return Object.freeze(model.parts.map((part, index): IR.GlyphPart => {
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
    const independentlyRendered = composition.kind !== 'compound';
    return Object.freeze({
      id: part.id,
      role: part.role,
      zIndex: part.zIndex,
      d: built.d,
      // Отдельная часть compound-модели не имеет самостоятельного fill rule:
      // cog/tablet доказывают, что присвоить здесь nonzero — публичная ложь.
      fillRule: independentlyRendered ? 'nonzero' : null,
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

function modelAllowed(model: ModelVariantContract, mode: IR.ModelMode): boolean {
  if (mode === 'source-only') return false;
  if (model.state === 'accepted') return true;
  return mode === 'allow-candidate';
}

/** Состояние модели читается без её построения и без побочных эффектов. */
function motionCapabilities(context: GlyphCompilerSession, icon: IR.IconId, variant: IR.IconVariant, model?: ModelVariantContract): IR.MotionCapabilities {
  const { catalog, motionAdapters } = context as unknown as GlyphCompilerState;
  if (!model) {
    const source = catalog.icons[icon].source[variant];
    if (source.anatomy && source.gestures?.length) {
      const gestures = source.gestures.map(gesture => Object.freeze({
        ...gesture,
        partIds: Object.freeze([...gesture.partIds]),
        tracks: Object.freeze(gesture.tracks.map(track => Object.freeze({
          ...track,
          ...(track.kind === 'rotate' ? { anchor: Object.freeze([...track.anchor] as [number, number]) }
            : { stops: Object.freeze(track.stops.map(stop => Object.freeze({ ...stop }))) }),
        }))),
      }));
      return Object.freeze({
        state: 'gesture-ready',
        partIds: Object.freeze(source.parts.map(part => part.id)),
        tracks: Object.freeze([...new Map(gestures.flatMap(gesture => gesture.tracks.map(track => {
          const id = track.kind === 'translate' ? `translate.${track.axis}.${track.partId}` : `${track.kind}.${track.partId}`;
          const capability: IR.MotionTrackContract = Object.freeze(track.kind === 'rotate' ? {
            id, kind: 'rotate', partIds: Object.freeze([track.partId]), anchor: track.anchor,
          } : track.kind === 'translate' ? { id, kind: 'translate', partIds: Object.freeze([track.partId]), axis: track.axis, unit: track.unit }
            : { id, kind: 'opacity', partIds: Object.freeze([track.partId]) });
          return [id, capability] as const;
        }))).values()]),
        gestures: Object.freeze(gestures),
        adapters: motionAdapters,
      });
    }
    if (source.anatomy && Array.isArray(source.gestures) && source.gestures.length === 0 &&
        source.parts.every(part => part.identity === 'declared')) {
      return Object.freeze({ state: 'semantic-parts', partIds: Object.freeze(source.parts.map(part => part.id)),
        tracks: Object.freeze([]), gestures: Object.freeze([]), adapters: motionAdapters });
    }
    return Object.freeze({
      state: 'source-only',
      partIds: Object.freeze([]),
      tracks: Object.freeze([]),
      gestures: Object.freeze([]),
      adapters: motionAdapters,
    });
  }
  if (model.state !== 'accepted') {
    return Object.freeze({
      state: 'candidate',
      partIds: Object.freeze([]),
      tracks: Object.freeze([]),
      gestures: Object.freeze([]),
      adapters: motionAdapters,
    });
  }

  const partIds = Object.freeze(model.parts.map((part) => part.id));
  const declaredParts = anatomyGlyph(context, icon)?.parts ?? [];
  const tracks = declaredParts
    .filter((part) =>
      part.primitive === 'clock-hand' &&
      typeof part.id === 'string' &&
      Array.isArray(part.anchor) &&
      part.anchor.length === 2 &&
      part.anchor.every((value) => Number.isFinite(value)) &&
      partIds.includes(part.id),
    )
    .map((part) => Object.freeze({
      id: `rotate.${part.id!}`,
      kind: 'rotate' as const,
      partIds: Object.freeze([part.id!]),
      anchor: Object.freeze([...part.anchor!] as [number, number]),
    }));

  const declaredGestures = anatomyGlyph(context, icon)?.motion?.gestures ?? [];
  const gestures = declaredGestures
    .filter((gesture) => gesture.partIds.every((partId) => partIds.includes(partId)))
    .map((gesture) => Object.freeze({
      id: gesture.id,
      kind: gesture.kind,
      partIds: Object.freeze([...gesture.partIds]),
      meaning: gesture.meaning,
      progress: gesture.progress,
      ...(gesture.restProgress !== undefined ? { restProgress: gesture.restProgress } : {}),
      tracks: Object.freeze(gesture.tracks.map((track) => Object.freeze({
        partId: track.partId,
        kind: track.kind,
        anchor: Object.freeze([...track.anchor] as [number, number]),
        from: track.from,
        to: track.to,
        unit: track.unit,
        interpolation: track.interpolation,
      }))),
    }));

  return Object.freeze({
    state: gestures.length > 0 ? 'gesture-ready' : tracks.length > 0 ? 'anchored-parts' : 'semantic-parts',
    partIds,
    tracks: Object.freeze(tracks),
    gestures: Object.freeze(gestures),
    adapters: motionAdapters,
  });
}

/** @internal Регистрирует candidates; первая декларация имени остаётся авторитетной. */
export function registerCandidateAnatomyValue(
  context: GlyphCompilerSession,
  glyphs: Readonly<Record<string, AnatomyGlyph>>,
  variants: readonly CandidateVariantRegistration[],
): void {
  const { anatomy, candidateGlyphs, registeredCandidateVariants } = context as unknown as GlyphCompilerState;
  // Доступ открывает только канонический субпат: мусорный объект не может
  // включить mixed-модель, чья declaration уже находится в runtime-проекции.
  for (const registration of variants) {
    registeredCandidateVariants.add(registration);
  }
  for (const [name, glyph] of Object.entries(glyphs)) {
    if (name in anatomy.glyphs) continue; // runtime-проекция авторитетна
    if (candidateGlyphs.has(name)) continue;
    candidateGlyphs.set(name, glyph);
  }
}

/** @internal */
export function readGlyphCapabilities(
  context: GlyphCompilerSession,
  iconValue: unknown,
  variantValue: unknown = 'outline',
): IR.GlyphCapabilities {
  const { catalog, axisContracts } = context as unknown as GlyphCompilerState;
  const icon = parseIconIdValue(context, iconValue);
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
    motion: motionCapabilities(context, icon, variant, model),
    ...(model ? {} : catalog.icons[icon].source[variant].anatomy && {
      anatomy: Object.freeze({ ...catalog.icons[icon].source[variant].anatomy! }),
    }),
  });
}

/**
 * @internal
 * Строит воспроизводимый Glyph IR. При недоступной в выбранном режиме модели
 * запрос без осей получает точный source fallback; оси никогда не теряются
 * молча и в таком случае приводят к ошибке.
 */
export function compileGlyph(context: GlyphCompilerSession, request: IR.GlyphRequest): IR.GlyphIR {
  const { catalog, registeredCandidateVariants } = context as unknown as GlyphCompilerState;
  const parsed = parseGlyphRequestValue(context, request);
  const iconContract = catalog.icons[parsed.icon];
  const modelContract = iconContract.model;
  const model = modelContract?.variants[parsed.variant];

  let parts: readonly IR.GlyphPart[];
  let provenance: IR.GlyphProvenance;
  let composition: IR.GlyphComposition;

  if (modelContract && model && modelAllowed(model, parsed.modelMode)) {
    // INV-06: гейт по состоянию модели, не по наличию декларации — mixed-иконки
    // (candidate-вариант при декларации, попавшей в runtime через accepted-соседа)
    // без регистрации корпуса тоже обязаны падать, а не строиться молча.
    if (model.state !== 'accepted' && !registeredCandidateVariants.has(`${parsed.icon}/${parsed.variant}`)) {
      throw new GlyphModelError(
        'CANDIDATES_REQUIRED',
        `@labpics/icons/ir: candidate-модель ${parsed.icon}/${parsed.variant} требует ` +
          'регистрации корпуса: @labpics/icons/ir/candidates (registerCandidates)',
      );
    }
    const axes = effectiveAxes(context, model, parsed.axes);
    parts = modelParts(
      context,
      parsed.icon,
      parsed.variant,
      modelContract,
      model,
      model.composition,
      axes,
    );
    provenance = Object.freeze({
      kind: 'model',
      declaration: modelContract.declaration,
      archetype: modelContract.archetype,
      state: model.state,
      axes,
    });
    composition = cloneGlyphComposition(model.composition);
  } else {
    const requestedAxes = Object.keys(parsed.axes);
    if (requestedAxes.length > 0) {
      throw new RangeError(
        `@labpics/icons/ir: ${parsed.icon}/${parsed.variant} не имеет ` +
          `разрешённой модели для осей ${requestedAxes.join(', ')}`,
      );
    }
    const source = iconContract.source[parsed.variant];
    parts = sourceParts(context, parsed.icon, parsed.variant, source);
    provenance = Object.freeze({
      kind: 'source', file: source.file,
      ...(source.anatomy && { anatomy: Object.freeze({ ...source.anatomy }) }),
    });
    composition = cloneGlyphComposition(source.composition ?? { kind: 'layers' });
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

/** Точный shell-контракт принадлежит calendar recipe. */
const CALENDAR_SHELL_CONTRACT = Object.freeze({
  outline: Object.freeze({
    dependency: 'calendar-number' as IR.IconId,
    // Geometry fingerprint из canonical catalog: любое редактирование shell
    // требует осознанно перепривязать recipe вместо выбора «самого большого» path.
    sourcePartId: 'source-c18fd85190d3',
  }),
  filled: Object.freeze({
    dependency: 'calendar-clear' as IR.IconId,
    sourcePartId: 'source-87d6cad16173',
  }),
});

/**
 * Динамический calendar-number: точная shell-геометрия корпуса + собственные
 * tabular digits. Функция ничего не планирует и не читает часы сама.
 */
export function compileCalendarNumberGlyph(context: GlyphCompilerSession, input: CalendarNumberGlyphInput): IR.GlyphIR {
  const { catalog } = context as unknown as GlyphCompilerState;
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
    context,
    dependency,
    variant,
    catalog.icons[dependency].source[variant],
  );
  const shellSource = source.find((part) => part.id === shellContract.sourcePartId);
  if (!shellSource) {
    throw new Error(`@labpics/icons/ir: shell contract ${dependency}/${variant} дрейфует`);
  }

  const shell: IR.GlyphPart = Object.freeze({
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

  const digitParts: IR.GlyphPart[] = number.parts.map((part) => Object.freeze({
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
  const composition: IR.GlyphComposition = variant === 'outline'
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

/** @internal Полный фасад сохраняет прежний API и единственного владельца состояния. */
export function createGlyphCompiler(input: Parameters<typeof createGlyphCompilerSession>[0]): GlyphCompiler & { readonly registerCandidateAnatomy: CandidateAnatomyRegistration } {
  const context = createGlyphCompilerSession(input);
  function glyph(request: IR.GlyphRequest): IR.GlyphIR { return compileGlyph(context, request); }
  function glyphCapabilities(iconValue: unknown, variantValue: unknown = 'outline'): IR.GlyphCapabilities { return readGlyphCapabilities(context, iconValue, variantValue); }
  function parseGlyphRequest(value: unknown): ParsedGlyphRequest { return parseGlyphRequestValue(context, value); }
  function parseIconId(value: unknown): IR.IconId { return parseIconIdValue(context, value); }
  function isIconId(value: unknown): value is IR.IconId { return checkIconId(context, value); }
  function registerCandidateAnatomy(glyphs: Readonly<Record<string, AnatomyGlyph>>, variants: readonly CandidateVariantRegistration[]): void { registerCandidateAnatomyValue(context, glyphs, variants); }
  function calendarNumberGlyph(input: CalendarNumberGlyphInput): IR.GlyphIR { return compileCalendarNumberGlyph(context, input); }
  const { iconIds, axisNames, axisContracts, iconDesignContract } = context;
  return Object.freeze({ glyph, glyphCapabilities, parseGlyphRequest, parseIconId, isIconId, registerCandidateAnatomy, calendarNumberGlyph, iconIds, axisNames, axisContracts, iconDesignContract }) satisfies GlyphCompiler;
}
