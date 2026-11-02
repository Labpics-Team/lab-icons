import type {
  ContourStateCapabilities, ContourStateEffectRequest, ContourStateEffectResult, ContourStateExportRequest,
  ContourStateRenderRequest, ContourStateTarget, PreparedContourStateEffect,
  StateSvgResult, SymbolContourStateEffect,
} from '../states/contour-types.js';
import type { StateRefusal, StateRefusalCode } from '../states/common-types.js';
import { sha256Hex } from './sha256.js';

const commands = ['M', 'C', 'C', 'C', 'C', 'Z'] as const;
const name = /^[a-z][a-z0-9-]*$/;
const numberToken = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/y;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function refuse(code: StateRefusalCode, message: string): StateRefusal {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
const normalized = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** Проверка исходной строки в фиксированном представлении MCCCCZ. */
function endpointMatches(text: unknown, vector: readonly number[]): text is string {
  if (typeof text !== 'string' || text.length > 4096) return false;
  let offset = 0, operand = 0;
  const whitespace = () => { while (offset < text.length && /[\t\n\r ]/.test(text[offset]!)) offset++; };
  for (const command of commands) {
    whitespace();
    if (text[offset++] !== command) return false;
    const count = command === 'M' ? 2 : command === 'C' ? 6 : 0;
    for (let index = 0; index < count; index++) {
      whitespace();
      if (index && text[offset] === ',') { offset++; whitespace(); }
      numberToken.lastIndex = offset;
      const token = numberToken.exec(text);
      if (!token || Number(token[0]) !== vector[operand++]) return false;
      offset = numberToken.lastIndex;
    }
  }
  whitespace();
  return offset === text.length && operand === vector.length;
}

function target(value: unknown): value is ContourStateTarget {
  const topology = record(value) ? value.commands : null;
  if (!record(value) || typeof value.partId !== 'string' || !name.test(value.partId) || value.property !== 'd' ||
      !Array.isArray(topology) || topology.length !== 6 || !commands.every((command, index) => topology[index] === command) ||
      !Array.isArray(value.vectors) || value.vectors.length !== 2 || !Array.isArray(value.endpoints) || value.endpoints.length !== 2) return false;
  const endpoints = value.endpoints;
  return Array.from(value.vectors).every((vector, index) => Array.isArray(vector) && vector.length === 26 &&
    vector.every(item => typeof item === 'number' && Number.isFinite(item)) && vector[0] === vector[24] && vector[1] === vector[25] &&
    endpointMatches(endpoints[index], vector));
}
function snapshotTarget(value: unknown): unknown {
  if (!record(value)) return null;
  const vectors = value.vectors, endpoints = value.endpoints, topology = value.commands;
  if (!Array.isArray(vectors) || vectors.length !== 2 || !Array.isArray(endpoints) || endpoints.length !== 2 ||
      !Array.isArray(topology) || topology.length !== 6 || !Array.from(vectors).every(vector => Array.isArray(vector) && vector.length === 26)) return null;
  return { partId: value.partId, property: value.property, commands: [...topology],
    vectors: Array.from(vectors, vector => [...vector]), endpoints: [...endpoints] };
}
function serialize(vector: readonly number[]): string {
  return `M${vector.slice(0, 2).join(' ')}${[0, 1, 2, 3].map(index => `C${vector.slice(2 + index * 6, 8 + index * 6).join(' ')}`).join('')}Z`;
}

/** Разово проверяет переносимые численные данные; авторство проверяет сборка. */
export function prepareContourStateEffect(effect: SymbolContourStateEffect): PreparedContourStateEffect {
  if (!record(effect) || effect.contract !== 'labpics.symbol-state-effect/1' || effect.version !== 1 || effect.kind !== 'contour-interpolation' ||
      typeof effect.group !== 'string' || !name.test(effect.group) || !['outline', 'filled'].includes(effect.variant) ||
      !['horizontal', 'vertical'].includes(effect.targetState) || effect.to !== (effect.targetState === 'horizontal' ? 0 : 1) ||
      !normalized(effect.from) || !normalized(effect.to) || !Array.isArray(effect.targets) || !effect.targets.length || effect.targets.length > 3 ||
      !Array.isArray(effect.unchangedPartIds) || effect.unchangedPartIds.length > 3 ||
      new Set(effect.unchangedPartIds).size !== effect.unchangedPartIds.length ||
      Array.from(effect.unchangedPartIds).some(id => typeof id !== 'string' || !name.test(id)) ||
      !record(effect.options) || !Number.isFinite(effect.options.duration) || effect.options.duration < 0 ||
      effect.options.easing !== 'linear' || effect.options.fill !== 'both') {
    return refuse('EFFECT_UNSUPPORTED', 'Нужны конечные данные замкнутого контура MCCCCZ.');
  }
  // Копия сохраняет данные после JSON-переноса и последующих изменений входа.
  const copied = Array.from(effect.targets, snapshotTarget);
  if (!copied.every(target) || new Set(copied.map(item => item.partId)).size !== copied.length ||
      effect.unchangedPartIds.some(id => copied.some(item => item.partId === id))) {
    return refuse('EFFECT_UNSUPPORTED', 'Нужны различные части и согласованные конечные endpoints.');
  }
  const targets = copied;
  return Object.freeze({ ok: true, sample(progress: number) {
    if (!normalized(progress)) return refuse('INVALID_REQUEST', 'Прогресс принадлежит [0,1].');
    const parts = [];
    for (const item of targets) {
      let d;
      if (progress === 0 || progress === 1) d = item.endpoints[progress]!;
      else {
        const [a, b] = item.vectors as [number[], number[]];
        // Одна монотонная арифметическая операция для всех соответствующих координат.
        const values = a.map((value, index) => (1 - progress) * value + progress * b[index]!);
        if (!values.every(Number.isFinite)) return refuse('POSE_UNREPRESENTABLE', 'Интерполяция не представима конечными Number.');
        d = serialize(values);
      }
      parts.push(Object.freeze({ partId: item.partId, d }));
    }
    return Object.freeze({ ok: true, parts: Object.freeze(parts) });
  } });
}

interface StateData { readonly variant: 'outline' | 'filled'; readonly defaultState: string; readonly states: readonly string[] }
interface RendererData extends StateData { readonly staticSvg: Readonly<Record<string, string>> }
function request(state: string, input: unknown, data: StateData, allowed: readonly string[]): StateRefusal | null {
  if (!data.states.includes(state)) return refuse('STATE_UNSUPPORTED', 'Состояние не объявлено.');
  if (!record(input) || Object.keys(input).some(key => !allowed.includes(key))) return refuse('INVALID_REQUEST', 'Неизвестные параметры состояния.');
  if (input.variant !== undefined && (typeof input.variant !== 'string' || !['outline', 'filled'].includes(input.variant))) return refuse('INVALID_REQUEST', 'Начертание outline или filled.');
  if (input.variant !== undefined && input.variant !== data.variant) return refuse('VARIANT_UNSUPPORTED', 'Начертания не интерполируются друг в друга.');
  if (input.variation !== undefined) {
    if (!record(input.variation) || Object.keys(input.variation).some(key => !['dotScale', 'spacingScale'].includes(key)) ||
        Object.values(input.variation).some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      return refuse('INVALID_REQUEST', 'Нужны положительные конечные variation множители.');
    }
    if (Object.values(input.variation).some(value => value !== 1)) return refuse('VARIATION_UNSUPPORTED', 'Переход на всём интервале проверен только для множителей 1/1.');
  }
  return null;
}
/** @internal Отдельные данные статического SVG не удерживают эффекты и возможности. */
export function createCompiledContourStateRenderer(input: RendererData) {
  const data = freezeTree(input);
  return (state = data.defaultState, options: ContourStateRenderRequest = {}): StateSvgResult => {
    const invalid = request(state, options, data, ['variant', 'variation']);
    return invalid ?? Object.freeze({ ok: true, svg: data.staticSvg[state]! });
  };
}
interface EffectData extends StateData {
  readonly group: string;
  readonly targets: readonly ContourStateTarget[];
  readonly geometrySha256: string;
}
/** @internal Принимает скомпилированные данные, проверенные сборкой. */
export function createCompiledContourStateEffects(input: EffectData) {
  const data = freezeTree(input);
  if (sha256Hex(JSON.stringify(data.targets)) !== data.geometrySha256) throw new TypeError('Геометрия контура не совпадает с хэшем сборки.');
  if (!data.targets.every(target)) throw new TypeError('Представление контура не поддержано.');
  const moving = data.targets.filter(item => item.endpoints[0] !== item.endpoints[1]);
  const unchanged = data.targets.filter(item => item.endpoints[0] === item.endpoints[1]).map(item => item.partId);
  function compile(state: string, options: unknown, exported: boolean): ContourStateEffectResult {
    const invalid = request(state, options, data, ['variant', 'variation', 'duration', 'from', 'reducedMotion', ...(exported ? ['format'] : [])]);
    if (invalid) return invalid;
    const parameters = options as Record<string, unknown>;
    if (exported && parameters.format !== 'web-effect') return refuse('FORMAT_UNSUPPORTED', 'Переход поддерживает только web-effect.');
    const from = parameters.from === undefined ? 0 : parameters.from;
    if (!normalized(from) || typeof parameters.duration !== 'number' || !Number.isFinite(parameters.duration) || parameters.duration < 0 ||
        parameters.reducedMotion !== undefined && typeof parameters.reducedMotion !== 'boolean') return refuse('INVALID_REQUEST', 'from принадлежит [0,1], длительность конечна и ≥0.');
    const effect: SymbolContourStateEffect = freezeTree({ contract: 'labpics.symbol-state-effect/1', version: 1, kind: 'contour-interpolation',
      group: data.group, variant: data.variant, targetState: state, from, to: state === 'horizontal' ? 0 : 1,
      targets: moving, unchangedPartIds: unchanged,
      options: { duration: parameters.reducedMotion ? 0 : parameters.duration, easing: 'linear', fill: 'both' } });
    return Object.freeze({ ok: true, effect });
  }
  return Object.freeze({ compileStateEffect: (state: string, options: ContourStateEffectRequest) => compile(state, options, false),
    exportStateTransition: (state: string, options: ContourStateExportRequest) => compile(state, options, true) });
}
/** @internal Отдельные данные возможностей не удерживаются статическим SVG и эффектами. */
export function createCompiledContourStateCapabilities<TState extends string>(input: ContourStateCapabilities<TState>) {
  const data = freezeTree(input);
  return () => data;
}
