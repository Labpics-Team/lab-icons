import type {
  StateEffectRequest, StateEffectResult, StateGroupCapabilities, StateRefusal,
  StateRefusalCode, StateRenderRequest, StateSvgResult, StateTransitionExportRequest,
} from './types.js';

interface CompiledStateIdentity {
  readonly group: string;
  readonly variant: 'outline' | 'filled';
}

interface CompiledStateRuntime extends CompiledStateIdentity {
  readonly defaultState: string;
  readonly frame: readonly [string, string];
  readonly sharedSvg: string;
  readonly sharedPartIds: readonly string[];
  readonly states: readonly (readonly [id: string, partId: string,
    contentSvg: string, staticSharedSvg?: string])[];
}

interface CompiledStateCapabilities extends CompiledStateIdentity {
  readonly defaultState: string;
  readonly sharedPartIds: readonly string[];
  readonly enclosurePartId: string;
  readonly states: StateGroupCapabilities['states'];
  readonly proof: StateGroupCapabilities['proof'];
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function refuse(code: StateRefusalCode, message: string): StateRefusal {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validate(data: CompiledStateIdentity, byState: ReadonlyMap<string, unknown>,
  state: string, request: unknown, allowed: readonly string[]): StateRefusal | null {
  if (typeof state !== 'string' || !byState.has(state)) {
    return refuse('STATE_UNSUPPORTED', `Состояние не объявлено для ${data.group}.`);
  }
  if (!record(request) || Object.keys(request).some(key => !allowed.includes(key))) {
    return refuse('INVALID_REQUEST', 'Нужен объект с известными параметрами.');
  }
  const variant = request.variant === undefined ? data.variant : request.variant;
  if (typeof variant !== 'string' || !['outline', 'filled'].includes(variant)) {
    return refuse('INVALID_REQUEST', 'Начертание: outline или filled.');
  }
  if (variant !== data.variant) {
    return refuse('VARIANT_UNSUPPORTED', `Для ${data.group}/${String(variant)} равенство оболочек не доказано.`);
  }
  return null;
}

/** @internal Render/переходы не получают capabilities или авторские receipts. */
export function createCompiledStateRuntime(input: CompiledStateRuntime) {
  const data = freezeTree(input);
  const byState = new Map(data.states.map(state => [state[0], state]));

  function render(state = data.defaultState, request: StateRenderRequest = {}): StateSvgResult {
    const invalid = validate(data, byState, state, request, ['variant']);
    if (invalid) return invalid;
    const [, , contentSvg, staticSharedSvg] = byState.get(state)!;
    return Object.freeze({ ok: true, svg: data.frame[0] + contentSvg + (staticSharedSvg ?? data.sharedSvg) + data.frame[1] });
  }

  function renderStateSvg(state = data.defaultState, request: StateRenderRequest = {}): StateSvgResult {
    const invalid = validate(data, byState, state, request, ['variant']);
    if (invalid) return invalid;
    const groups = data.states.map(([id, partId, contentSvg]) =>
      `<g data-part="${partId}" data-role="state" data-state="${id}" opacity="${id === state ? 1 : 0}">` +
      contentSvg + '</g>').join('');
    return Object.freeze({ ok: true, svg: data.frame[0] + groups + data.sharedSvg + data.frame[1] });
  }

  function effect(state: string, request: unknown, exported: boolean): StateEffectResult {
    const invalid = validate(data, byState, state, request, exported
      ? ['duration', 'reducedMotion', 'variant', 'format'] : ['duration', 'reducedMotion', 'variant']);
    if (invalid) return invalid;
    const parameters = request as Record<string, unknown>;
    if (exported && parameters.format !== 'web-effect') {
      if (typeof parameters.format !== 'string') return refuse('INVALID_REQUEST', 'Формат обязан быть явной строкой.');
      return refuse('FORMAT_UNSUPPORTED', `Переход ${data.group} не экспортируется в ${parameters.format}.`);
    }
    if (typeof parameters.duration !== 'number' || !Number.isFinite(parameters.duration) || parameters.duration < 0 ||
        (parameters.reducedMotion !== undefined && typeof parameters.reducedMotion !== 'boolean')) {
      return refuse('INVALID_REQUEST', 'Конечная длительность ≥0; reducedMotion boolean.');
    }
    const duration = parameters.reducedMotion ? 0 : parameters.duration;
    return freezeTree({ ok: true, effect: {
      contract: 'labpics.symbol-state-effect/1', version: 1, kind: 'enclosure-replacement',
      group: data.group, variant: data.variant, targetState: state,
      // Все группы остаются mounted. Consumer связывает первый interval с видимой
      // opacity, включая смесь после прерывания; effect не задаёт from или сброс.
      stages: data.states.map(([id, partId]) => ({ partId, property: 'opacity',
        to: id === state ? 1 : 0, at: 0, duration })),
      unchangedPartIds: data.sharedPartIds,
      options: { duration, easing: 'linear', fill: 'both' },
    } });
  }

  function compileStateEffect(state: string, request: StateEffectRequest): StateEffectResult {
    return effect(state, request, false);
  }
  function exportStateTransition(state: string, request: StateTransitionExportRequest): StateEffectResult {
    return effect(state, request, true);
  }
  return Object.freeze({ render, renderStateSvg, compileStateEffect, exportStateTransition });
}

/** @internal Сборка уже выделила metadata; потребитель не загружает SVG/эффекты. */
export function createCompiledStateCapabilities(input: CompiledStateCapabilities) {
  const capabilities = freezeTree<StateGroupCapabilities>({
    group: input.group, variant: input.variant, defaultState: input.defaultState,
    transition: 'enclosure-replacement', morph: 'unavailable', enclosurePartId: input.enclosurePartId,
    sharedPartIds: input.sharedPartIds, states: input.states,
    formats: { static: ['svg'], transition: ['web-effect'] }, proof: input.proof,
  });
  return function stateCapabilities() { return capabilities; };
}
