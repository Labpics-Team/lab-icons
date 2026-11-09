import { createCompiledStateRuntime as createRuntime, createCompiledStateCapabilities as createCapabilities } from './runtime.js';
import type { StateRefusal } from './types.js';
import type { SourceStateRenderRequest, SourceStateEffectRequest, SourceStateTransitionExportRequest } from './source-types.js';

type RuntimeInput = Parameters<typeof createRuntime>[0];
type CapabilityInput = Parameters<typeof createCapabilities>[0];
declare const __LAB_ICONS_REPLACEMENT_KIND__: string;

if (typeof __LAB_ICONS_REPLACEMENT_KIND__ === 'undefined' || __LAB_ICONS_REPLACEMENT_KIND__ !== 'source-replacement') {
  throw new Error('source-state-runtime: source replacement build profile is required');
}

function refuse(code: StateRefusal['reason']['code'], message: string): StateRefusal {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
}

/** Только source opt-in добавляет admission; эффект и mounted-группы создаёт общий runtime. */
export function createCompiledStateRuntime(input: RuntimeInput) {
  const core = createRuntime(input);
  function validate(state: string, request: unknown): StateRefusal | null {
    // На обычном разрешённом запросе core единолично проверяет state/keys/variant.
    if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
    const parameters = request as Record<string, unknown>;
    const hasVariation = Object.hasOwn(parameters, 'variation');
    const foreignVariant = (parameters.variant === 'outline' || parameters.variant === 'filled') && parameters.variant !== input.variant;
    if (!hasVariation && !foreignVariant) return null;
    if (typeof state !== 'string' || !input.states.some(member => member[0] === state)) {
      return refuse('STATE_UNSUPPORTED', `Состояние не объявлено для ${input.group}.`);
    }
    if (hasVariation) {
      const variation = parameters.variation;
      return variation !== null && typeof variation === 'object' && !Array.isArray(variation)
        ? refuse('VARIATION_UNSUPPORTED', 'Для точной замены этих авторских состояний вариация геометрии не доказана.')
        : refuse('INVALID_REQUEST', 'Вариация обязана быть объектом.');
    }
    return refuse('VARIANT_UNSUPPORTED', `Для ${input.group}/${String(parameters.variant)} группа авторских состояний не объявлена.`);
  }
  function render(state = input.defaultState, request: SourceStateRenderRequest = {}) {
    return validate(state, request) ?? core.render(state, request);
  }
  function renderStateSvg(state = input.defaultState, request: SourceStateRenderRequest = {}) {
    return validate(state, request) ?? core.renderStateSvg(state, request);
  }
  function compileStateEffect(state: string, request: SourceStateEffectRequest) {
    return validate(state, request) ?? core.compileStateEffect(state, request);
  }
  function exportStateTransition(state: string, request: SourceStateTransitionExportRequest) {
    return validate(state, request) ?? core.exportStateTransition(state, request);
  }
  return Object.freeze({ render, renderStateSvg, compileStateEffect, exportStateTransition });
}

export function createCompiledStateCapabilities(input: CapabilityInput) {
  return createCapabilities(input);
}
