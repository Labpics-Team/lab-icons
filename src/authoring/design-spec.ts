import {
  opticalLimits,
  type NegativeSpaceConstraint,
  type NormalizedPoint,
  type RecipeFillPaint,
  type RecipePart,
  type RecipeResult,
  type RecipeStrokePaint,
} from '../ir/recipes.js';
import {
  designRecipeRegistryContract,
  designResidualRecipeContract,
  designScalarTokens,
  registeredRecipeDefinition,
  type DesignScalarTokenId,
  type DesignScalarUnit,
  type RecipeParameterContract,
  type RegisteredDesignRecipeId,
} from './authority.js';
// @ts-ignore — существующий zero-IO geometry owner пока JS-only.
import { _canonicalPoint, _negativeSpaceConstraint, buildConstructivePrimitive } from '../core/glyph-operators.js';
// @ts-expect-error — существующий zero-IO geometry owner пока JS-only.
import { genSuperellipse, topologySignature as computeTopologySignature } from '../core/anatomy-gen.js';
// @ts-expect-error — существующий exact geometry utility пока JS-only.
import { pathBBox } from '../core/path-data.js';

export type DesignSpecErrorCode =
  | 'UNSUPPORTED_VERSION'
  | 'UNKNOWN_FIELD'
  | 'RAW_PATH_FORBIDDEN'
  | 'ARBITRARY_POINTS_FORBIDDEN'
  | 'ANONYMOUS_TRANSFORM_FORBIDDEN'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_REFERENCE'
  | 'ANCHOR_CYCLE'
  | 'INVALID_VALUE'
  | 'UNDERDEFINED_CONSTRAINT'
  | 'CONTRADICTORY_CONSTRAINT'
  | 'UNBOUNDED_RESIDUAL'
  | 'FREE_SCALAR_FORBIDDEN'
  | 'UNKNOWN_SCALAR_TOKEN'
  | 'SCALAR_UNIT_MISMATCH'
  | 'UNKNOWN_RECIPE'
  | 'UNSUPPORTED_RECIPE_VERSION'
  | 'UNKNOWN_RECIPE_PARAMETER'
  | 'OPAQUE_RECIPE_PARAMETER_FORBIDDEN'
  | 'RECIPE_PARAMETER_OUT_OF_DOMAIN'
  | 'RECIPE_OUTPUT_DRIFT'
  | 'RAW_FALLBACK_FORBIDDEN'
  | 'CONSTRAINT_VIOLATION';

export class DesignSpecError extends Error {
  readonly code: DesignSpecErrorCode;
  readonly at: string;

  constructor(code: DesignSpecErrorCode, at: string, message: string) {
    super(`DesignSpec ${at}: ${message}`);
    this.name = 'DesignSpecError';
    this.code = code;
    this.at = at;
  }
}

const STABLE_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const PART_ROLES = [
  'body', 'content', 'ink', 'counter', 'container', 'control', 'detail', 'decorator',
] as const;
const CANVAS_ANCHORS = Object.freeze({
  center: Object.freeze({ x: 0.5, y: 0.5 }),
  north: Object.freeze({ x: 0.5, y: 0 }),
  'north-east': Object.freeze({ x: 1, y: 0 }),
  east: Object.freeze({ x: 1, y: 0.5 }),
  'south-east': Object.freeze({ x: 1, y: 1 }),
  south: Object.freeze({ x: 0.5, y: 1 }),
  'south-west': Object.freeze({ x: 0, y: 1 }),
  west: Object.freeze({ x: 0, y: 0.5 }),
  'north-west': Object.freeze({ x: 0, y: 0 }),
} as const);
const PRIMITIVE_KINDS = ['circle', 'ellipse', 'line', 'arc', 'capsule', 'rect'] as const;
const ANCHOR_KINDS = ['canvas', 'midpoint', 'polar', 'project'] as const;
const COMPOSITION_KINDS = ['layers', 'compound', 'mask-subtract'] as const;
const DECORATOR_KINDS = ['overlay', 'knockout', 'enclosure'] as const;
const NEGATIVE_SPACE_KINDS = ['exterior-margin', 'gap'] as const;
const NEGATIVE_SPACE_MEASUREMENTS = [
  'ink-bounds-to-canvas', 'axis-aligned-group-bounds-separation',
] as const;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const designSpecContract = deepFreeze({
  schema: 'labpics.design-spec/2',
  version: 2,
  canvas: {
    unit: 'normalized-canvas',
    paintedInkContainment: 'required',
  },
  primitiveKinds: PRIMITIVE_KINDS,
  anchorKinds: ANCHOR_KINDS,
  canvasAnchors: Object.keys(CANVAS_ANCHORS),
  partRoles: PART_ROLES,
  compositionKinds: COMPOSITION_KINDS,
  decoratorKinds: DECORATOR_KINDS,
  negativeSpaceKinds: NEGATIVE_SPACE_KINDS,
  negativeSpaceMeasurements: NEGATIVE_SPACE_MEASUREMENTS,
  scalarTokens: designScalarTokens,
  recipeRegistry: designRecipeRegistryContract,
  residualRecipes: designResidualRecipeContract,
  forbidden: {
    rawPath: ['d', 'path', 'svg', 'pathData'],
    arbitraryPoints: ['points', 'controls', 'controlPoints', 'beziers'],
    anonymousTransforms: [
      'transform', 'transforms', 'offset', 'offsets', 'dx', 'dy', 'translate', 'scale', 'matrix',
    ],
    rawFallback: ['raw', 'fallback', 'rawGeometry', 'rawRecipe'],
  },
});

type CanvasAnchorName = keyof typeof CANVAS_ANCHORS;
type PartRole = (typeof PART_ROLES)[number];
type DesignNegativeSpaceKind = (typeof NEGATIVE_SPACE_KINDS)[number];
type DesignNegativeSpaceMeasurement = (typeof NEGATIVE_SPACE_MEASUREMENTS)[number];

export type DesignScalarRef = Readonly<{ token: DesignScalarTokenId }>;

export type DesignAnchor =
  | Readonly<{ id: string; kind: 'canvas'; at: CanvasAnchorName }>
  | Readonly<{ id: string; kind: 'midpoint'; between: readonly [string, string] }>
  | Readonly<{ id: string; kind: 'polar'; from: string; angle: DesignScalarRef; distance: DesignScalarRef }>
  | Readonly<{ id: string; kind: 'project'; xFrom: string; yFrom: string }>;

export type DesignGeometry =
  | Readonly<{ kind: 'circle'; center: string; radius: DesignScalarRef }>
  | Readonly<{ kind: 'ellipse'; center: string; rx: DesignScalarRef; ry: DesignScalarRef; rotation: DesignScalarRef }>
  | Readonly<{ kind: 'line'; from: string; to: string }>
  | Readonly<{ kind: 'arc'; center: string; radius: DesignScalarRef; startAngle: DesignScalarRef; endAngle: DesignScalarRef; direction: 'cw' | 'ccw' }>
  | Readonly<{ kind: 'capsule'; from: string; to: string; radius: DesignScalarRef }>
  | Readonly<{ kind: 'rect'; center: string; width: DesignScalarRef; height: DesignScalarRef; cornerRadius: DesignScalarRef }>
  | Readonly<{ kind: 'residual'; recipe: 'superellipse'; center: string; rx: DesignScalarRef; ry: DesignScalarRef; exponent: DesignScalarRef; rotation: DesignScalarRef }>;

export type DesignPaint =
  | Readonly<{ kind: 'fill' }>
  | Readonly<{ kind: 'stroke'; width: DesignScalarRef; linecap: 'round' | 'butt' }>;

export interface DesignPart {
  readonly id: string;
  readonly role: PartRole;
  readonly geometry: DesignGeometry;
  readonly paint: DesignPaint;
  readonly morphGroup?: string;
}

export type DesignComposition =
  | Readonly<{ kind: 'layers' }>
  | Readonly<{ kind: 'compound'; fillRule: 'nonzero' | 'evenodd' }>
  | Readonly<{ kind: 'mask-subtract'; basePartIds: readonly string[]; subtractPartIds: readonly string[] }>;

export interface DesignDecorator {
  readonly id: string;
  readonly kind: 'overlay' | 'knockout' | 'enclosure';
  readonly partId: string;
  readonly targetPartIds: readonly string[];
}

export interface DesignNegativeSpace {
  readonly id: string;
  readonly kind: DesignNegativeSpaceKind;
  readonly minimum: DesignScalarRef;
  readonly participants: readonly string[];
  readonly measurement: DesignNegativeSpaceMeasurement;
}

export interface ConstructiveDesignSpec {
  readonly version: 2;
  readonly kind: 'constructive';
  readonly anchors: readonly DesignAnchor[];
  readonly parts: readonly DesignPart[];
  readonly composition: DesignComposition;
  readonly decorators: readonly DesignDecorator[];
  readonly negativeSpace: readonly DesignNegativeSpace[];
}

export interface DesignRecipeInvocation {
  readonly id: string;
  readonly recipe: RegisteredDesignRecipeId;
  readonly recipeVersion: number;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
}

export interface RecipeDesignSpec {
  readonly version: 2;
  readonly kind: 'recipe';
  readonly invocation: DesignRecipeInvocation;
}

export type DesignSpec = ConstructiveDesignSpec | RecipeDesignSpec;

export interface LoweredConstructiveDesignSpec extends RecipeResult {
  readonly kind: 'design-spec';
  readonly parts: readonly LoweredDesignPart[];
  readonly composition: DesignComposition;
  readonly decorators: readonly DesignDecorator[];
  readonly anchors: Readonly<Record<string, NormalizedPoint>>;
  readonly specVersion: 2;
}

export interface LoweredRecipeDesignSpec extends RecipeResult {
  readonly kind: 'design-spec-recipe';
  readonly anchors: Readonly<Record<string, NormalizedPoint>>;
  readonly recipe: Readonly<{
    invocationId: string;
    id: RegisteredDesignRecipeId;
    version: number;
    parameters: Readonly<Record<string, number | string | boolean>>;
  }>;
  readonly specVersion: 2;
}

export type LoweredDesignSpec = LoweredConstructiveDesignSpec | LoweredRecipeDesignSpec;

export interface LoweredDesignPart extends RecipePart {
  readonly morphGroup: string | null;
}

function fail(code: DesignSpecErrorCode, at: string, message: string): never {
  throw new DesignSpecError(code, at, message);
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_VALUE', at, 'ожидается объект');
  }
  return value as Record<string, unknown>;
}

function classifyUnknownField(key: string, at: string): never {
  if ((designSpecContract.forbidden.rawPath as readonly string[]).includes(key)) {
    fail('RAW_PATH_FORBIDDEN', at, `поле ${key} передаёт raw path`);
  }
  if ((designSpecContract.forbidden.arbitraryPoints as readonly string[]).includes(key)) {
    fail('ARBITRARY_POINTS_FORBIDDEN', at, `поле ${key} передаёт arbitrary point/control payload`);
  }
  if ((designSpecContract.forbidden.anonymousTransforms as readonly string[]).includes(key)) {
    fail('ANONYMOUS_TRANSFORM_FORBIDDEN', at, `поле ${key} передаёт anonymous transform/offset`);
  }
  if ((designSpecContract.forbidden.rawFallback as readonly string[]).includes(key)) {
    fail('RAW_FALLBACK_FORBIDDEN', at, `поле ${key} создаёт необъявленный geometry fallback`);
  }
  fail('UNKNOWN_FIELD', at, `неизвестное поле ${key}`);
}

function exact(
  value: unknown,
  at: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const source = record(value, at);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) classifyUnknownField(key, at);
  }
  for (const key of required) {
    if (!Object.hasOwn(source, key)) fail('INVALID_VALUE', at, `нет обязательного поля ${key}`);
  }
  return source;
}

function parseScalarRef(
  value: unknown,
  at: string,
  unit: DesignScalarUnit,
  min: number,
  max: number,
  exclusiveMin = false,
): DesignScalarRef {
  if (typeof value === 'number') {
    fail(
      'FREE_SCALAR_FORBIDDEN',
      at,
      'свободный numeric literal запрещён; используйте registered scalar token или named recipe parameter',
    );
  }
  const source = exact(value, at, ['token']);
  if (typeof source.token !== 'string') {
    fail('UNKNOWN_SCALAR_TOKEN', `${at}.token`, 'ожидается id registered scalar token');
  }
  const token = designScalarTokens[source.token as DesignScalarTokenId];
  if (!token) {
    fail('UNKNOWN_SCALAR_TOKEN', `${at}.token`, `неизвестный scalar token ${source.token}`);
  }
  if (token.unit !== unit) {
    fail(
      'SCALAR_UNIT_MISMATCH',
      `${at}.token`,
      `token ${source.token} имеет unit=${token.unit}, требуется ${unit}`,
    );
  }
  if (token.value < min || token.value > max || (exclusiveMin && token.value === min)) {
    fail(
      'INVALID_VALUE',
      `${at}.token`,
      `token ${source.token}=${token.value} вне ${exclusiveMin ? '(' : '['}${min},${max}]`,
    );
  }
  return Object.freeze({ token: source.token as DesignScalarTokenId });
}

function scalarValue(value: DesignScalarRef): number {
  return designScalarTokens[value.token].value;
}

function stableId(value: unknown, at: string): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) fail('INVALID_VALUE', at, 'ожидается stable id');
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], at: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail('INVALID_VALUE', at, `ожидается ${allowed.join('|')}`);
  }
  return value as T;
}

function idList(value: unknown, at: string, minimum = 1): string[] {
  if (!Array.isArray(value) || value.length < minimum) fail('INVALID_VALUE', at, `нужно минимум ${minimum} id`);
  const ids = value.map((item, index) => stableId(item, `${at}[${index}]`));
  if (new Set(ids).size !== ids.length) fail('INVALID_VALUE', at, 'дубликаты id запрещены');
  return ids;
}

function parseAnchor(value: unknown, index: number): DesignAnchor {
  const at = `anchors[${index}]`;
  const base = record(value, at);
  const id = stableId(base.id, `${at}.id`);
  const kind = oneOf(base.kind, ANCHOR_KINDS, `${at}.kind`);
  if (kind === 'canvas') {
    const source = exact(value, at, ['id', 'kind', 'at']);
    return { id, kind, at: oneOf(source.at, Object.keys(CANVAS_ANCHORS) as CanvasAnchorName[], `${at}.at`) };
  }
  if (kind === 'midpoint') {
    const source = exact(value, at, ['id', 'kind', 'between']);
    if (!Array.isArray(source.between) || source.between.length !== 2) {
      fail('INVALID_VALUE', `${at}.between`, 'нужны ровно два named anchors');
    }
    return {
      id,
      kind,
      between: [
        stableId(source.between[0], `${at}.between[0]`),
        stableId(source.between[1], `${at}.between[1]`),
      ],
    };
  }
  if (kind === 'polar') {
    const source = exact(value, at, ['id', 'kind', 'from', 'angle', 'distance']);
    return {
      id,
      kind,
      from: stableId(source.from, `${at}.from`),
      angle: parseScalarRef(source.angle, `${at}.angle`, 'degrees', -360, 360),
      distance: parseScalarRef(source.distance, `${at}.distance`, 'normalized-canvas', 0, 1, true),
    };
  }
  const source = exact(value, at, ['id', 'kind', 'xFrom', 'yFrom']);
  return {
    id,
    kind,
    xFrom: stableId(source.xFrom, `${at}.xFrom`),
    yFrom: stableId(source.yFrom, `${at}.yFrom`),
  };
}

function anchorDependencies(anchor: DesignAnchor): readonly string[] {
  if (anchor.kind === 'canvas') return [];
  if (anchor.kind === 'midpoint') return anchor.between;
  if (anchor.kind === 'polar') return [anchor.from];
  return [anchor.xFrom, anchor.yFrom];
}

function validateAnchorGraph(anchors: readonly DesignAnchor[]): void {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) fail('ANCHOR_CYCLE', `anchors.${id}`, 'циклическая relation');
    const anchor = byId.get(id);
    if (!anchor) fail('UNKNOWN_REFERENCE', `anchors.${id}`, `неизвестный anchor ${id}`);
    visiting.add(id);
    for (const dependency of anchorDependencies(anchor)) {
      if (!byId.has(dependency)) fail('UNKNOWN_REFERENCE', `anchors.${id}`, `неизвестный anchor ${dependency}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const anchor of anchors) visit(anchor.id);
}

function parseGeometry(value: unknown, at: string): DesignGeometry {
  const base = record(value, at);
  for (const key of Object.keys(base)) {
    const forbidden = [
      ...designSpecContract.forbidden.rawPath,
      ...designSpecContract.forbidden.arbitraryPoints,
      ...designSpecContract.forbidden.anonymousTransforms,
    ];
    if ((forbidden as readonly string[]).includes(key)) classifyUnknownField(key, at);
  }
  const kind = oneOf(base.kind, [...PRIMITIVE_KINDS, 'residual'] as const, `${at}.kind`);
  if (kind === 'circle') {
    const source = exact(value, at, ['kind', 'center', 'radius']);
    return {
      kind,
      center: stableId(source.center, `${at}.center`),
      radius: parseScalarRef(source.radius, `${at}.radius`, 'normalized-canvas', 0, 0.5, true),
    };
  }
  if (kind === 'ellipse') {
    const source = exact(value, at, ['kind', 'center', 'rx', 'ry'], ['rotation']);
    return {
      kind,
      center: stableId(source.center, `${at}.center`),
      rx: parseScalarRef(source.rx, `${at}.rx`, 'normalized-canvas', 0, 0.5, true),
      ry: parseScalarRef(source.ry, `${at}.ry`, 'normalized-canvas', 0, 0.5, true),
      rotation: parseScalarRef(
        source.rotation ?? { token: 'angle.zero' },
        `${at}.rotation`,
        'degrees',
        -180,
        180,
      ),
    };
  }
  if (kind === 'line') {
    const source = exact(value, at, ['kind', 'from', 'to']);
    return {
      kind,
      from: stableId(source.from, `${at}.from`),
      to: stableId(source.to, `${at}.to`),
    };
  }
  if (kind === 'arc') {
    const source = exact(value, at, [
      'kind', 'center', 'radius', 'startAngle', 'endAngle', 'direction',
    ]);
    return {
      kind,
      center: stableId(source.center, `${at}.center`),
      radius: parseScalarRef(source.radius, `${at}.radius`, 'normalized-canvas', 0, 0.5, true),
      startAngle: parseScalarRef(source.startAngle, `${at}.startAngle`, 'degrees', -360, 360),
      endAngle: parseScalarRef(source.endAngle, `${at}.endAngle`, 'degrees', -360, 360),
      direction: oneOf(source.direction, ['cw', 'ccw'] as const, `${at}.direction`),
    };
  }
  return parseGeometryTail(kind, value, at);
}

function parseGeometryTail(
  kind: 'capsule' | 'rect' | 'residual',
  value: unknown,
  at: string,
): DesignGeometry {
  if (kind === 'capsule') {
    const source = exact(value, at, ['kind', 'from', 'to', 'radius']);
    return {
      kind,
      from: stableId(source.from, `${at}.from`),
      to: stableId(source.to, `${at}.to`),
      radius: parseScalarRef(source.radius, `${at}.radius`, 'normalized-canvas', 0, 0.5, true),
    };
  }
  if (kind === 'rect') {
    const source = exact(value, at, ['kind', 'center', 'width', 'height'], ['cornerRadius']);
    const width = parseScalarRef(source.width, `${at}.width`, 'normalized-canvas', 0, 1, true);
    const height = parseScalarRef(source.height, `${at}.height`, 'normalized-canvas', 0, 1, true);
    const maxCorner = Math.min(scalarValue(width), scalarValue(height)) / 2;
    return {
      kind,
      center: stableId(source.center, `${at}.center`),
      width,
      height,
      cornerRadius: parseScalarRef(
        source.cornerRadius ?? { token: 'canvas.zero' },
        `${at}.cornerRadius`,
        'normalized-canvas',
        0,
        maxCorner,
      ),
    };
  }

  const source = exact(
    value,
    at,
    ['kind', 'recipe', 'center', 'rx', 'ry', 'exponent'],
    ['rotation'],
  );
  if (source.recipe !== 'superellipse') {
    fail('UNBOUNDED_RESIDUAL', `${at}.recipe`, 'residual recipe не зарегистрирован');
  }
  const domain = designSpecContract.residualRecipes.superellipse.domain;
  return {
    kind,
    recipe: 'superellipse',
    center: stableId(source.center, `${at}.center`),
    rx: parseScalarRef(source.rx, `${at}.rx`, 'normalized-canvas', 0, domain.rx.max, true),
    ry: parseScalarRef(source.ry, `${at}.ry`, 'normalized-canvas', 0, domain.ry.max, true),
    exponent: parseScalarRef(source.exponent, `${at}.exponent`, 'ratio', domain.exponent.min, domain.exponent.max),
    rotation: parseScalarRef(
      source.rotation ?? { token: 'angle.zero' },
      `${at}.rotation`,
      'degrees',
      domain.rotation.min,
      domain.rotation.max,
    ),
  };
}

function parsePaint(value: unknown, at: string): DesignPaint {
  const base = record(value, at);
  const kind = oneOf(base.kind, ['fill', 'stroke'] as const, `${at}.kind`);
  if (kind === 'fill') {
    exact(value, at, ['kind']);
    return { kind };
  }
  const source = exact(value, at, ['kind', 'width'], ['linecap']);
  return {
    kind,
    width: parseScalarRef(source.width, `${at}.width`, 'normalized-canvas', 0, 0.5, true),
    linecap: oneOf(source.linecap ?? 'round', ['round', 'butt'] as const, `${at}.linecap`),
  };
}

function geometryAnchorReferences(geometry: DesignGeometry): readonly string[] {
  if (geometry.kind === 'line' || geometry.kind === 'capsule') return [geometry.from, geometry.to];
  return [geometry.center];
}

function parsePart(value: unknown, index: number): DesignPart {
  const at = `parts[${index}]`;
  const source = exact(value, at, ['id', 'role', 'geometry', 'paint'], ['morphGroup']);
  const geometry = parseGeometry(source.geometry, `${at}.geometry`);
  const paint = parsePaint(source.paint, `${at}.paint`);
  if ((geometry.kind === 'line' || geometry.kind === 'arc') && paint.kind !== 'stroke') {
    fail('INVALID_VALUE', `${at}.paint`, `${geometry.kind} допускает только stroke`);
  }
  const parsed: DesignPart = {
    id: stableId(source.id, `${at}.id`),
    role: oneOf(source.role, PART_ROLES, `${at}.role`),
    geometry,
    paint,
  };
  if (source.morphGroup !== undefined) {
    return { ...parsed, morphGroup: stableId(source.morphGroup, `${at}.morphGroup`) };
  }
  return parsed;
}

function parseComposition(value: unknown): DesignComposition {
  const base = record(value, 'composition');
  const kind = oneOf(base.kind, COMPOSITION_KINDS, 'composition.kind');
  if (kind === 'layers') {
    exact(value, 'composition', ['kind']);
    return { kind };
  }
  if (kind === 'compound') {
    const source = exact(value, 'composition', ['kind', 'fillRule']);
    return {
      kind,
      fillRule: oneOf(source.fillRule, ['nonzero', 'evenodd'] as const, 'composition.fillRule'),
    };
  }
  const source = exact(value, 'composition', ['kind', 'basePartIds', 'subtractPartIds']);
  return {
    kind,
    basePartIds: idList(source.basePartIds, 'composition.basePartIds'),
    subtractPartIds: idList(source.subtractPartIds, 'composition.subtractPartIds'),
  };
}

function parseDecorator(value: unknown, index: number): DesignDecorator {
  const at = `decorators[${index}]`;
  const source = exact(value, at, ['id', 'kind', 'partId', 'targetPartIds']);
  return {
    id: stableId(source.id, `${at}.id`),
    kind: oneOf(source.kind, DECORATOR_KINDS, `${at}.kind`),
    partId: stableId(source.partId, `${at}.partId`),
    targetPartIds: idList(source.targetPartIds, `${at}.targetPartIds`),
  };
}

function parseNegativeSpace(value: unknown, index: number): DesignNegativeSpace {
  const at = `negativeSpace[${index}]`;
  const source = exact(value, at, ['id', 'kind', 'minimum', 'participants', 'measurement']);
  const kind = oneOf(source.kind, NEGATIVE_SPACE_KINDS, `${at}.kind`);
  const measurement = oneOf(source.measurement, NEGATIVE_SPACE_MEASUREMENTS, `${at}.measurement`);
  const requiredMeasurement = kind === 'exterior-margin'
    ? 'ink-bounds-to-canvas'
    : 'axis-aligned-group-bounds-separation';
  if (measurement !== requiredMeasurement) {
    fail(
      'CONTRADICTORY_CONSTRAINT',
      `${at}.measurement`,
      `kind=${kind} требует measurement=${requiredMeasurement}`,
    );
  }
  const participants = idList(source.participants, `${at}.participants`);
  if (measurement === 'axis-aligned-group-bounds-separation' && participants.length !== 2) {
    fail('UNDERDEFINED_CONSTRAINT', `${at}.participants`, 'bbox separation требует ровно двух participants');
  }
  return {
    id: stableId(source.id, `${at}.id`),
    kind,
    minimum: parseScalarRef(source.minimum, `${at}.minimum`, 'normalized-canvas', 0, 0.5),
    participants,
    measurement,
  };
}

function assertUniqueIds(values: readonly { id: string }[], at: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) fail('DUPLICATE_ID', at, `повторяется id ${value.id}`);
    seen.add(value.id);
  }
}

function assertConstraintUniqueness(constraints: readonly DesignNegativeSpace[]): void {
  const seen = new Map<string, string>();
  for (const constraint of constraints) {
    const key = `${constraint.kind}|${constraint.measurement}|${[...constraint.participants].sort().join(',')}`;
    const previous = seen.get(key);
    if (previous) {
      fail(
        'CONTRADICTORY_CONSTRAINT',
        `negativeSpace.${constraint.id}`,
        `constraint дублирует ${previous} для тех же participants`,
      );
    }
    seen.set(key, constraint.id);
  }
}

function assertReferences(spec: Omit<ConstructiveDesignSpec, 'version' | 'kind'>): void {
  const anchorIds = new Set(spec.anchors.map(({ id }) => id));
  const partIds = new Set(spec.parts.map(({ id }) => id));
  const partsById = new Map(spec.parts.map((part) => [part.id, part]));
  for (const part of spec.parts) {
    for (const anchorId of geometryAnchorReferences(part.geometry)) {
      if (!anchorIds.has(anchorId)) {
        fail('UNKNOWN_REFERENCE', `parts.${part.id}.geometry`, `неизвестный anchor ${anchorId}`);
      }
    }
  }
  const requirePart = (id: string, at: string) => {
    if (!partIds.has(id)) fail('UNKNOWN_REFERENCE', at, `неизвестный part ${id}`);
  };
  if (spec.composition.kind === 'mask-subtract') {
    const composition = spec.composition;
    const overlap = composition.basePartIds.filter((id) => composition.subtractPartIds.includes(id));
    if (overlap.length > 0) {
      fail('CONTRADICTORY_CONSTRAINT', 'composition', `part одновременно base и subtract: ${overlap.join(',')}`);
    }
    for (const id of composition.basePartIds) requirePart(id, 'composition.basePartIds');
    for (const id of composition.subtractPartIds) requirePart(id, 'composition.subtractPartIds');
    const classified = new Set([...composition.basePartIds, ...composition.subtractPartIds]);
    const missing = [...partIds].filter((id) => !classified.has(id));
    if (missing.length > 0) {
      fail(
        'UNDERDEFINED_CONSTRAINT',
        'composition',
        `mask-subtract обязан классифицировать каждую часть ровно один раз; пропущены ${missing.join(',')}`,
      );
    }
  }
  for (const decorator of spec.decorators) {
    requirePart(decorator.partId, `decorators.${decorator.id}.partId`);
    for (const id of decorator.targetPartIds) requirePart(id, `decorators.${decorator.id}.targetPartIds`);
    if (decorator.targetPartIds.includes(decorator.partId)) {
      fail(
        'CONTRADICTORY_CONSTRAINT',
        `decorators.${decorator.id}`,
        'decorator не может одновременно быть собственной целью',
      );
    }
    if (partsById.get(decorator.partId)?.role !== 'decorator') {
      fail(
        'CONTRADICTORY_CONSTRAINT',
        `decorators.${decorator.id}.partId`,
        'decorator part обязан иметь semantic role=decorator',
      );
    }
    if (spec.composition.kind === 'mask-subtract') {
      const base = new Set(spec.composition.basePartIds);
      const subtract = new Set(spec.composition.subtractPartIds);
      const partIsSubtract = subtract.has(decorator.partId);
      if (decorator.kind === 'knockout' ? !partIsSubtract : !base.has(decorator.partId)) {
        fail(
          'CONTRADICTORY_CONSTRAINT',
          `decorators.${decorator.id}`,
          `${decorator.kind} противоречит mask-subtract classification`,
        );
      }
      const invalidTargets = decorator.targetPartIds.filter((id) => !base.has(id));
      if (invalidTargets.length > 0) {
        fail(
          'CONTRADICTORY_CONSTRAINT',
          `decorators.${decorator.id}.targetPartIds`,
          `decorator target обязан быть положительной base-частью: ${invalidTargets.join(',')}`,
        );
      }
    } else if (decorator.kind === 'knockout') {
      fail(
        'CONTRADICTORY_CONSTRAINT',
        `decorators.${decorator.id}`,
        'knockout требует явной mask-subtract composition',
      );
    }
  }
  for (const constraint of spec.negativeSpace) {
    for (const id of constraint.participants) requirePart(id, `negativeSpace.${constraint.id}.participants`);
  }
}

function parseRecipeParameter(
  value: unknown,
  contract: RecipeParameterContract,
  at: string,
): number | string | boolean {
  if (value !== null && typeof value === 'object') {
    fail(
      'OPAQUE_RECIPE_PARAMETER_FORBIDDEN',
      at,
      'recipe parameter обязан быть скаляром/enum/bool, вложенная geometry map запрещена',
    );
  }
  if (contract.kind === 'enum') {
    if (typeof value !== 'string' || !contract.values.includes(value)) {
      fail('RECIPE_PARAMETER_OUT_OF_DOMAIN', at, `ожидается ${contract.values.join('|')}`);
    }
    return value;
  }
  if (contract.kind === 'boolean') {
    if (typeof value !== 'boolean') fail('RECIPE_PARAMETER_OUT_OF_DOMAIN', at, 'ожидается boolean');
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('RECIPE_PARAMETER_OUT_OF_DOMAIN', at, 'ожидается конечное число');
  }
  const { domain } = contract;
  if (
    (domain.min !== undefined && value < domain.min)
    || (domain.minExclusive !== undefined && value <= domain.minExclusive)
    || (domain.max !== undefined && value > domain.max)
    || (domain.integer === true && !Number.isInteger(value))
  ) {
    fail('RECIPE_PARAMETER_OUT_OF_DOMAIN', at, 'значение вне declared recipe domain');
  }
  return value;
}

function parseRecipeInvocation(value: unknown): DesignRecipeInvocation {
  const source = exact(value, 'invocation', [
    'id', 'recipe', 'recipeVersion', 'parameters',
  ]);
  const id = stableId(source.id, 'invocation.id');
  if (typeof source.recipe !== 'string' || !Object.hasOwn(designRecipeRegistryContract, source.recipe)) {
    fail('UNKNOWN_RECIPE', 'invocation.recipe', `неизвестный registered recipe ${String(source.recipe)}`);
  }
  const recipe = source.recipe as RegisteredDesignRecipeId;
  const definition = registeredRecipeDefinition(recipe);
  if (source.recipeVersion !== definition.contract.version) {
    fail(
      'UNSUPPORTED_RECIPE_VERSION',
      'invocation.recipeVersion',
      `${recipe} поддерживает version=${definition.contract.version}`,
    );
  }
  const rawParameters = record(source.parameters, 'invocation.parameters');
  const allowed: Readonly<Record<string, RecipeParameterContract>> = definition.contract.parameters;
  for (const key of Object.keys(rawParameters)) {
    if (!Object.hasOwn(allowed, key)) {
      fail('UNKNOWN_RECIPE_PARAMETER', `invocation.parameters.${key}`, `recipe ${recipe} не объявляет параметр ${key}`);
    }
  }
  const parameters: Record<string, number | string | boolean> = {};
  for (const [key, raw] of Object.entries(rawParameters)) {
    parameters[key] = parseRecipeParameter(
      raw,
      allowed[key]!,
      `invocation.parameters.${key}`,
    );
  }
  const opszContract = allowed.opsz;
  const opsz = typeof parameters.opsz === 'number'
    ? parameters.opsz
    : opszContract?.kind === 'number' && typeof opszContract.default === 'number'
      ? opszContract.default
      : undefined;
  if (opsz !== undefined) {
    const limits = opticalLimits({ opsz });
    for (const [key, parameterContract] of Object.entries(allowed)) {
      if (parameterContract.kind !== 'number' || !parameterContract.domain.opticalMinimum) continue;
      const supplied = parameters[key];
      if (typeof supplied !== 'number') continue;
      const minimum = limits[parameterContract.domain.opticalMinimum];
      if (supplied < minimum) {
        fail(
          'RECIPE_PARAMETER_OUT_OF_DOMAIN',
          `invocation.parameters.${key}`,
          `${key}=${supplied} ниже ${parameterContract.domain.opticalMinimum}=${minimum} при opsz=${opsz}`,
        );
      }
    }
  }
  return deepFreeze({
    id,
    recipe,
    recipeVersion: definition.contract.version,
    parameters,
  });
}

export function parseDesignSpec(value: unknown): DesignSpec {
  const base = record(value, 'root');
  if (base.version !== 2) fail('UNSUPPORTED_VERSION', 'version', 'поддерживается только version=2');
  const kind = oneOf(base.kind, ['constructive', 'recipe'] as const, 'root.kind');
  if (kind === 'recipe') {
    const root = exact(value, 'root', ['version', 'kind', 'invocation']);
    return deepFreeze({
      version: 2,
      kind,
      invocation: parseRecipeInvocation(root.invocation),
    });
  }
  const root = exact(value, 'root', [
    'version', 'kind', 'anchors', 'parts', 'composition', 'decorators', 'negativeSpace',
  ]);
  if (!Array.isArray(root.anchors) || root.anchors.length === 0) {
    fail('INVALID_VALUE', 'anchors', 'нужен непустой массив');
  }
  if (!Array.isArray(root.parts) || root.parts.length === 0) {
    fail('INVALID_VALUE', 'parts', 'нужен непустой массив');
  }
  if (!Array.isArray(root.decorators)) fail('INVALID_VALUE', 'decorators', 'ожидается массив');
  if (!Array.isArray(root.negativeSpace)) fail('INVALID_VALUE', 'negativeSpace', 'ожидается массив');

  const anchors = root.anchors.map(parseAnchor);
  const parts = root.parts.map(parsePart);
  const composition = parseComposition(root.composition);
  const decorators = root.decorators.map(parseDecorator);
  const negativeSpace = root.negativeSpace.map(parseNegativeSpace);
  assertUniqueIds(anchors, 'anchors');
  assertUniqueIds(parts, 'parts');
  assertUniqueIds(decorators, 'decorators');
  assertUniqueIds(negativeSpace, 'negativeSpace');
  validateAnchorGraph(anchors);
  const parsed = { anchors, parts, composition, decorators, negativeSpace };
  assertReferences(parsed);
  assertConstraintUniqueness(negativeSpace);
  return deepFreeze({ version: 2, kind, ...parsed });
}

function resolveAnchors(anchors: readonly DesignAnchor[]): Readonly<Record<string, NormalizedPoint>> {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const resolved = new Map<string, NormalizedPoint>();
  const resolveAnchor = (id: string): NormalizedPoint => {
    const cached = resolved.get(id);
    if (cached) return cached;
    const anchor = byId.get(id);
    if (!anchor) fail('UNKNOWN_REFERENCE', `anchors.${id}`, `неизвестный anchor ${id}`);
    let point: NormalizedPoint;
    if (anchor.kind === 'canvas') {
      point = { ...CANVAS_ANCHORS[anchor.at] };
    } else if (anchor.kind === 'midpoint') {
      const first = resolveAnchor(anchor.between[0]);
      const second = resolveAnchor(anchor.between[1]);
      point = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    } else if (anchor.kind === 'polar') {
      const origin = resolveAnchor(anchor.from);
      const angle = scalarValue(anchor.angle);
      const distance = scalarValue(anchor.distance);
      const radians = angle * Math.PI / 180;
      point = {
        x: origin.x + Math.cos(radians) * distance,
        y: origin.y + Math.sin(radians) * distance,
      };
    } else {
      point = { x: resolveAnchor(anchor.xFrom).x, y: resolveAnchor(anchor.yFrom).y };
    }
    if (
      !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1
    ) {
      fail('INVALID_VALUE', `anchors.${id}`, 'relation вывела anchor за normalized canvas');
    }
    const canonical = Object.freeze(_canonicalPoint(point) as NormalizedPoint);
    resolved.set(id, canonical);
    return canonical;
  };
  for (const anchor of anchors) resolveAnchor(anchor.id);
  return deepFreeze(Object.fromEntries(anchors.map(({ id }) => [id, resolved.get(id)!])));
}

function lowerGeometry(
  geometry: DesignGeometry,
  anchors: Readonly<Record<string, NormalizedPoint>>,
) {
  const anchor = (id: string): NormalizedPoint => {
    const value = anchors[id];
    if (!value) fail('UNKNOWN_REFERENCE', `anchors.${id}`, `неизвестный anchor ${id}`);
    return value;
  };
  if (geometry.kind === 'residual') {
    const center = anchor(geometry.center);
    const d = genSuperellipse(
      center.x,
      center.y,
      scalarValue(geometry.rx),
      scalarValue(geometry.ry),
      scalarValue(geometry.exponent),
      scalarValue(geometry.rotation),
      false,
    );
    return {
      recipe: 'superellipse' as const,
      geometry: { kind: 'path' as const, d },
      bbox: pathBBox(d) as RecipePart['bbox'],
      topologySignature: computeTopologySignature(d) as string,
    };
  }
  if (geometry.kind === 'line') {
    return buildConstructivePrimitive({
      ...geometry,
      from: anchor(geometry.from),
      to: anchor(geometry.to),
    });
  }
  if (geometry.kind === 'capsule') {
    return buildConstructivePrimitive({
      kind: geometry.kind,
      from: anchor(geometry.from),
      to: anchor(geometry.to),
      radius: scalarValue(geometry.radius),
    });
  }
  if (geometry.kind === 'circle') {
    return buildConstructivePrimitive({
      kind: geometry.kind,
      center: anchor(geometry.center),
      radius: scalarValue(geometry.radius),
    });
  }
  if (geometry.kind === 'ellipse') {
    return buildConstructivePrimitive({
      kind: geometry.kind,
      center: anchor(geometry.center),
      rx: scalarValue(geometry.rx),
      ry: scalarValue(geometry.ry),
      rotation: scalarValue(geometry.rotation),
    });
  }
  if (geometry.kind === 'arc') {
    return buildConstructivePrimitive({
      kind: geometry.kind,
      center: anchor(geometry.center),
      radius: scalarValue(geometry.radius),
      startAngle: scalarValue(geometry.startAngle),
      endAngle: scalarValue(geometry.endAngle),
      direction: geometry.direction,
    });
  }
  return buildConstructivePrimitive({
    kind: geometry.kind,
    center: anchor(geometry.center),
    width: scalarValue(geometry.width),
    height: scalarValue(geometry.height),
    cornerRadius: scalarValue(geometry.cornerRadius),
  });
}

function lowerPaint(paint: DesignPaint): RecipeFillPaint | RecipeStrokePaint {
  if (paint.kind === 'fill') return Object.freeze({ kind: 'fill', fill: 'currentColor' });
  return Object.freeze({
    kind: 'stroke',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: scalarValue(paint.width),
    linecap: paint.linecap,
    linejoin: 'round',
  });
}

function inkBounds(
  bbox: RecipePart['bbox'],
  paint: RecipeFillPaint | RecipeStrokePaint,
): RecipePart['bbox'] {
  const half = paint.kind === 'stroke' ? paint.strokeWidth / 2 : 0;
  return Object.freeze({
    minX: bbox.minX - half,
    minY: bbox.minY - half,
    maxX: bbox.maxX + half,
    maxY: bbox.maxY + half,
  });
}

function assertPaintedInkInsideCanvas(bbox: RecipePart['bbox'], partId: string): void {
  const measured = Math.min(bbox.minX, bbox.minY, 1 - bbox.maxX, 1 - bbox.maxY);
  try {
    _negativeSpaceConstraint({
      kind: 'exterior-margin',
      requiredMinimum: 0,
      measured,
      measurementMethod: 'ink-bounds-to-canvas',
      participants: [partId, 'canvas'],
      name: `${partId}.canvas-containment`,
    });
  } catch (error) {
    fail('CONSTRAINT_VIOLATION', `parts.${partId}.paint`, String(error));
  }
}

function unionBounds(bounds: readonly RecipePart['bbox'][]): RecipePart['bbox'] {
  return {
    minX: Math.min(...bounds.map(({ minX }) => minX)),
    minY: Math.min(...bounds.map(({ minY }) => minY)),
    maxX: Math.max(...bounds.map(({ maxX }) => maxX)),
    maxY: Math.max(...bounds.map(({ maxY }) => maxY)),
  };
}

function boundsSeparation(first: RecipePart['bbox'], second: RecipePart['bbox']): number {
  const dx = Math.max(0, first.minX - second.maxX, second.minX - first.maxX);
  const dy = Math.max(0, first.minY - second.maxY, second.minY - first.maxY);
  return Math.hypot(dx, dy);
}

function lowerNegativeSpace(
  constraint: DesignNegativeSpace,
  parts: ReadonlyMap<string, RecipePart>,
): NegativeSpaceConstraint {
  const participantBounds = constraint.participants.map((id) => {
    const part = parts.get(id);
    if (!part) fail('UNKNOWN_REFERENCE', `negativeSpace.${constraint.id}`, `неизвестный part ${id}`);
    return part.bbox;
  });
  let measured: number;
  if (constraint.measurement === 'ink-bounds-to-canvas') {
    const bounds = unionBounds(participantBounds);
    measured = Math.min(bounds.minX, bounds.minY, 1 - bounds.maxX, 1 - bounds.maxY);
  } else {
    const first = participantBounds[0];
    const second = participantBounds[1];
    if (!first || !second) {
      fail('UNDERDEFINED_CONSTRAINT', `negativeSpace.${constraint.id}`, 'gap требует два bounds');
    }
    measured = boundsSeparation(first, second);
  }
  try {
    const proofParticipants = constraint.measurement === 'ink-bounds-to-canvas'
      ? [...constraint.participants, 'canvas']
      : [...constraint.participants];
    return deepFreeze(_negativeSpaceConstraint({
      kind: constraint.kind,
      requiredMinimum: scalarValue(constraint.minimum),
      measured,
      measurementMethod: constraint.measurement,
      participants: proofParticipants,
      name: constraint.id,
    }));
  } catch (error) {
    if (error instanceof DesignSpecError) throw error;
    fail('CONSTRAINT_VIOLATION', `negativeSpace.${constraint.id}`, String(error));
  }
}

function namespaceRecipeId(invocationId: string, id: string): string {
  return id === 'canvas' ? id : `${invocationId}.${id}`;
}

function lowerRecipeDesignSpec(spec: RecipeDesignSpec): LoweredRecipeDesignSpec {
  const definition = registeredRecipeDefinition(spec.invocation.recipe);
  let built: RecipeResult;
  try {
    built = definition.build(spec.invocation.parameters);
  } catch (error) {
    fail(
      'CONSTRAINT_VIOLATION',
      'invocation.parameters',
      `registered recipe ${spec.invocation.recipe} отверг комбинацию параметров: ${String(error)}`,
    );
  }
  const expectedParts = definition.contract.outputs.partIds;
  const actualParts = built.parts.map(({ id }) => id);
  const joins = built.joins ?? [];
  const actualAnchors = joins.map(({ id }) => id);
  const negativeSpaceIdentity = (constraint: {
    readonly kind: string;
    readonly measurementMethod: string;
  }) => `${constraint.kind}|${constraint.measurementMethod}`;
  const actualNegativeSpace = built.negativeSpace.constraints.map(negativeSpaceIdentity).sort();
  const expectedNegativeSpace = definition.contract.outputs.negativeSpace
    .map(negativeSpaceIdentity)
    .sort();
  if (
    JSON.stringify(actualParts) !== JSON.stringify(expectedParts)
    || JSON.stringify(actualAnchors) !== JSON.stringify(definition.contract.outputs.anchorIds)
    || JSON.stringify(actualNegativeSpace) !== JSON.stringify(expectedNegativeSpace)
  ) {
    fail(
      'RECIPE_OUTPUT_DRIFT',
      'invocation.recipe',
      `runtime output ${spec.invocation.recipe}@${spec.invocation.recipeVersion} не совпадает с registered contract`,
    );
  }
  const prefix = spec.invocation.id;
  const parts = Object.freeze(built.parts.map((part) => deepFreeze({
    ...part,
    id: namespaceRecipeId(prefix, part.id),
    ...(part.weld ? {
      weld: {
        ...part.weld,
        to: namespaceRecipeId(prefix, part.weld.to),
      },
    } : {}),
  })));
  const negativeSpace = deepFreeze({
    constraints: built.negativeSpace.constraints.map((constraint) => ({
      ...constraint,
      participants: constraint.participants.map((id) => namespaceRecipeId(prefix, id)),
    })),
  });
  const namespacedJoins = Object.freeze(joins.map((join) => deepFreeze({
    ...join,
    id: namespaceRecipeId(prefix, join.id),
    members: join.members.map((id) => namespaceRecipeId(prefix, id)),
  })));
  const anchors = deepFreeze(Object.fromEntries(
    namespacedJoins.map(({ id, at }) => [id, { ...at }]),
  ) as Record<string, NormalizedPoint>);
  return deepFreeze({
    kind: 'design-spec-recipe',
    canvas: { ...built.canvas },
    parts,
    negativeSpace,
    ...(built.metrics ? { metrics: built.metrics } : {}),
    joins: namespacedJoins,
    topologyKey: built.topologyKey
      ? `${prefix}:${built.topologyKey}`
      : `${prefix}:${parts.map(({ id, topologySignature }) => `${id}:${topologySignature}`).join('|')}`,
    anchors,
    recipe: {
      invocationId: prefix,
      id: spec.invocation.recipe,
      version: spec.invocation.recipeVersion,
      parameters: spec.invocation.parameters,
    },
    specVersion: 2,
  });
}

export function lowerDesignSpec(value: unknown): LoweredDesignSpec {
  const spec = parseDesignSpec(value);
  if (spec.kind === 'recipe') return lowerRecipeDesignSpec(spec);
  const anchors = resolveAnchors(spec.anchors);
  const parts = spec.parts.map((part): LoweredDesignPart => {
    let lowered: ReturnType<typeof lowerGeometry>;
    try {
      lowered = lowerGeometry(part.geometry, anchors);
    } catch (error) {
      if (error instanceof DesignSpecError) throw error;
      fail('INVALID_VALUE', `parts.${part.id}.geometry`, String(error));
    }
    const paint = lowerPaint(part.paint);
    const bbox = inkBounds(lowered.bbox, paint);
    assertPaintedInkInsideCanvas(bbox, part.id);
    return deepFreeze({
      id: part.id,
      role: part.role,
      geometry: lowered.geometry,
      paint,
      bbox,
      topologySignature: lowered.topologySignature,
      morphGroup: part.morphGroup ?? null,
    });
  });
  const byId = new Map(parts.map((part) => [part.id, part]));
  const negativeSpace = Object.freeze({
    constraints: Object.freeze(
      spec.negativeSpace.map((constraint) => lowerNegativeSpace(constraint, byId)),
    ),
  });
  return deepFreeze({
    kind: 'design-spec',
    canvas: { x: 0, y: 0, width: 1, height: 1 },
    parts,
    negativeSpace,
    topologyKey: `design-spec:${parts.map(({ id, topologySignature }) => `${id}:${topologySignature}`).join('|')}`,
    composition: spec.composition,
    decorators: spec.decorators,
    anchors,
    specVersion: 2,
  });
}
