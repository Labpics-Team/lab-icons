import type {
  StateEffectRequest, StateEffectResult, StateGroupCapabilities, StateRefusal,
  StateRefusalCode, StateRenderRequest, StateSvgResult, StateTransitionExportRequest,
} from './types.js';

interface CompiledStateGroup {
  readonly schemaVersion: 2;
  readonly group: string;
  readonly variant: 'outline' | 'filled';
  readonly defaultState: string;
  readonly frame: readonly [string, string];
  readonly sharedSvg: string;
  readonly sharedPartIds: readonly string[];
  readonly enclosurePartId: string;
  readonly states: readonly (StateGroupCapabilities['states'][number] & Readonly<{ contentSvg: string }>)[];
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

/** @internal Принимает только закрытый и проверенный build-time payload. */
export function createCompiledStateGroup(input: CompiledStateGroup) {
  const data = freezeTree(input);
  const byState = new Map(data.states.map(state => [state.id, state]));
  const capabilities = freezeTree<StateGroupCapabilities>({
    group: data.group, variant: data.variant, defaultState: data.defaultState,
    transition: 'enclosure-replacement', morph: 'unavailable', enclosurePartId: data.enclosurePartId,
    sharedPartIds: data.sharedPartIds,
    states: data.states.map(({ contentSvg: _, ...state }) => state),
    formats: { static: ['svg'], transition: ['web-effect'] }, proof: data.proof,
  });

  function validate(state: string, request: unknown, allowed: readonly string[]): StateRefusal | null {
    if (typeof state !== 'string' || !byState.has(state)) {
      return refuse('STATE_UNSUPPORTED', `Состояние не объявлено для ${data.group}.`);
    }
    if (!record(request) || Object.keys(request).some(key => !allowed.includes(key))) {
      return refuse('INVALID_REQUEST', 'Нужен объект только с поддержанными параметрами.');
    }
    const variant = request.variant === undefined ? data.variant : request.variant;
    if (typeof variant !== 'string' || !['outline', 'filled'].includes(variant)) {
      return refuse('INVALID_REQUEST', 'Начертание обязано быть outline или filled.');
    }
    if (variant !== data.variant) {
      return refuse('VARIANT_UNSUPPORTED', `Для ${data.group}/${String(variant)} равенство оболочек не доказано.`);
    }
    return null;
  }

  function render(state = data.defaultState, request: StateRenderRequest = {}): StateSvgResult {
    const invalid = validate(state, request, ['variant']);
    if (invalid) return invalid;
    const content = byState.get(state)!;
    return Object.freeze({ ok: true, svg: data.frame[0] + content.contentSvg + data.sharedSvg + data.frame[1] });
  }

  function renderStateSvg(state = data.defaultState, request: StateRenderRequest = {}): StateSvgResult {
    const invalid = validate(state, request, ['variant']);
    if (invalid) return invalid;
    const groups = data.states.map(member =>
      `<g data-part="${member.partId}" data-role="state" data-state="${member.id}" opacity="${member.id === state ? 1 : 0}">` +
      member.contentSvg + '</g>').join('');
    return Object.freeze({ ok: true, svg: data.frame[0] + groups + data.sharedSvg + data.frame[1] });
  }

  function effect(state: string, request: unknown, exported: boolean): StateEffectResult {
    const invalid = validate(state, request, exported
      ? ['duration', 'reducedMotion', 'variant', 'format'] : ['duration', 'reducedMotion', 'variant']);
    if (invalid) return invalid;
    const parameters = request as Record<string, unknown>;
    if (exported && parameters.format !== 'web-effect') {
      if (typeof parameters.format !== 'string') return refuse('INVALID_REQUEST', 'Формат обязан быть явной строкой.');
      return refuse('FORMAT_UNSUPPORTED', `Переход ${data.group} не экспортируется в ${parameters.format}.`);
    }
    if (typeof parameters.duration !== 'number' || !Number.isFinite(parameters.duration) || parameters.duration < 0 ||
        (parameters.reducedMotion !== undefined && typeof parameters.reducedMotion !== 'boolean')) {
      return refuse('INVALID_REQUEST', 'Нужны конечная длительность ≥0 и boolean reducedMotion.');
    }
    const duration = parameters.reducedMotion ? 0 : parameters.duration;
    return freezeTree({ ok: true, effect: {
      contract: 'labpics.symbol-state-effect/1', version: 1, kind: 'enclosure-replacement',
      group: data.group, variant: data.variant, targetState: state,
      // Все группы остаются mounted. Consumer связывает первый interval с видимой
      // opacity, включая смесь после прерывания; effect не задаёт from или сброс.
      stages: data.states.map(member => ({ partId: member.partId, property: 'opacity',
        to: member.id === state ? 1 : 0, at: 0, duration })),
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
  return Object.freeze({ render, renderStateSvg, compileStateEffect, exportStateTransition,
    stateCapabilities: () => capabilities });
}
