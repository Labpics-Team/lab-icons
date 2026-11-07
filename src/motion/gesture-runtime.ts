import { parseEffectRequest, projectRotationEffect } from './effect-projection.js';
import type { RotationGestureDefinition } from './effect-projection.js';
import type { MotionCapabilitiesResult, MotionEffectRequest, MotionEffectResult, MotionRefusal,
  MotionSvgResult, MotionSymbolCapabilities } from './gesture-types.js';

type Variant = 'outline' | 'filled';
type Variants<T> = Readonly<Partial<Record<Variant, T>>>;

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
function refuse(code: MotionRefusal['reason']['code'], message: string): MotionRefusal {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
}
function variantFor<T>(input: Variants<T>, requested: unknown): Variant | MotionRefusal {
  const variant = requested === undefined ? 'outline' : requested;
  if (variant !== 'outline' && variant !== 'filled') return refuse('INVALID_REQUEST', 'Начертание: outline или filled.');
  if (!Object.hasOwn(input, variant)) return refuse('VARIANT_UNSUPPORTED', `Для ${variant} нет подготовленного motion target.`);
  return variant;
}

/** @internal SVG уже собран владельцем; ни parsing, ни geometry generation. */
export function createCompiledMotionRenderer(input: Variants<string>) {
  const sources = freezeTree(input);
  return function renderMotionSvg(requested?: Variant): MotionSvgResult {
    const variant = variantFor(sources, requested);
    return typeof variant === 'string' ? Object.freeze({ ok: true, svg: sources[variant]! }) : variant;
  };
}

/** @internal Независимый PURE consumer не удерживает SVG или author receipts. */
export function createCompiledMotionEffects(icon: string, input: Variants<readonly RotationGestureDefinition[]>) {
  const gestures = freezeTree(input);
  return function compileMotionEffect(gestureId: string, request: MotionEffectRequest): MotionEffectResult {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(key => !['duration', 'from', 'to', 'reducedMotion', 'variant'].includes(key))) {
      return refuse('INVALID_REQUEST', 'Нужен объект с известными параметрами эффекта.');
    }
    const variant = variantFor(gestures, request.variant);
    if (typeof variant !== 'string') return variant;
    const { variant: _variant, ...parameters } = request;
    const parsed = parseEffectRequest(parameters);
    if (!parsed.ok) return parsed;
    const gesture = gestures[variant]!.find(item => item.id === gestureId);
    if (!gesture) return refuse('GESTURE_UNSUPPORTED', 'Жест не объявлен для выбранного motion target.');
    return Object.freeze({ ok: true, effect: projectRotationEffect(icon, variant, gesture, parsed) });
  };
}

/** @internal Metadata не удерживает paths, эффект или общий IR каталог. */
export function createCompiledMotionCapabilities(input: Variants<MotionSymbolCapabilities>) {
  const capabilities = freezeTree(input);
  return function motionCapabilities(requested?: Variant): MotionCapabilitiesResult {
    const variant = variantFor(capabilities, requested);
    return typeof variant === 'string' ? Object.freeze({ ok: true, capabilities: capabilities[variant]! }) : variant;
  };
}
