import type { AuthorIconId } from './author-catalog.generated.js';
import type { BodyWidthRefusal, BodyWidthMotionCapabilities, BodyWidthMotionCapabilitiesResult,
  PrepareBodyWidthResult, PreparedBodyWidth } from './author-capsule-motion-types.js';
import type { CapsulePathContour } from './capsule-path.js';
import { prepareCapsulePath } from './capsule-path.js';
import { sha256Hex } from './sha256.js';

type Variant = 'outline' | 'filled';
type Variants<T> = Readonly<Partial<Record<Variant, T>>>;
/** @internal Физический target готовит compiler; caller не передаёт path/program. */
export interface CompiledBodyWidthMotion {
  readonly version: 1;
  readonly law: 'capsule.width';
  readonly icon: AuthorIconId;
  readonly variant: Variant;
  readonly domain: Readonly<{ minimum: number; maximum: 1 }>;
  readonly contours: readonly CapsulePathContour[];
  readonly svg: string;
  readonly originalD: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly renderTarget: PreparedBodyWidth['renderTarget'];
  readonly packetSha256: string;
}
const stableJSON = (value: unknown): string => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]])) : item);
function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree); Object.freeze(value);
  }
  return value;
}
function refuse(code: BodyWidthRefusal['reason']['code'], message: string): BodyWidthRefusal {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
}
function selectVariant<T>(values: Variants<T>, requested: unknown): Variant | BodyWidthRefusal {
  const variant = requested === undefined ? 'outline' : requested;
  if (variant !== 'outline' && variant !== 'filled') return refuse('INVALID_REQUEST', 'Начертание: outline или filled.');
  if (!Object.hasOwn(values, variant)) return refuse('VARIANT_UNSUPPORTED', 'Для начертания нет подготовленной вариации ширины.');
  return variant;
}

/** @internal Hash/binding проверяются один раз; кадр не создаёт IR или receipt. */
export function createCompiledBodyWidthPreparation(input: Variants<CompiledBodyWidthMotion>) {
  const packets = freezeTree(input), prepared: Partial<Record<Variant, PreparedBodyWidth>> = {};
  for (const variant of ['outline', 'filled'] as const) {
    const packet = packets[variant];
    if (!packet) continue;
    const { packetSha256, ...program } = packet;
    if (packetSha256 !== sha256Hex(stableJSON(program)) || packet.version !== 1 || packet.law !== 'capsule.width' ||
        packet.variant !== variant || !Number.isFinite(packet.domain.minimum) || packet.domain.minimum <= 0 ||
        packet.domain.minimum >= 1 || packet.domain.maximum !== 1 || packet.renderTarget.attribute !== 'd' ||
        !packet.contours.length || packet.contours.length > 2 || packet.contours.some(contour =>
          !contour.points.length || contour.points.length !== contour.rates.length ||
          contour.points.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value))) ||
          contour.rates.some(value => !Number.isFinite(value))) || !packet.svg || !packet.originalD || !packet.renderTarget.selector) {
      throw new TypeError('body width motion: неподтверждённый compiler packet');
    }
    const path = prepareCapsulePath(packet.contours);
    prepared[variant] = Object.freeze({ version: 1, icon: packet.icon, variant, law: 'capsule.width',
      svg: packet.svg, domain: packet.domain, renderTarget: packet.renderTarget,
      sample: (bodyWidth: number) => {
        if (typeof bodyWidth !== 'number' || !Number.isFinite(bodyWidth)) return refuse('INVALID_REQUEST', 'Body width обязан быть конечным числом.');
        if (bodyWidth < packet.domain.minimum || bodyWidth > packet.domain.maximum) {
          return refuse('VARIATION_OUTSIDE_DOMAIN', 'Body width выходит за допущенную оптическую область.');
        }
        return Object.freeze({ ok: true as const, bodyWidth,
          d: bodyWidth === 1 ? packet.originalD : packet.prefix + path(bodyWidth) + packet.suffix });
      },
    });
  }
  return function prepareBodyWidth(requested?: Variant): PrepareBodyWidthResult {
    const variant = selectVariant(prepared, requested);
    return typeof variant === 'string' ? Object.freeze({ ok: true, prepared: prepared[variant]! }) : variant;
  };
}

/** @internal Независимый PURE metadata consumer не удерживает width operands/SVG. */
export function createCompiledBodyWidthCapabilities(input: Variants<BodyWidthMotionCapabilities>) {
  const capabilities = freezeTree(input);
  return function motionCapabilities(requested?: Variant): BodyWidthMotionCapabilitiesResult {
    const variant = selectVariant(capabilities, requested);
    return typeof variant === 'string' ? Object.freeze({ ok: true, capabilities: capabilities[variant]! }) : variant;
  };
}
