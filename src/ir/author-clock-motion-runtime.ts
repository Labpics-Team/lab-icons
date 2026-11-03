import { sha256Hex } from './sha256.js';
import type { ClockHandsCapabilities, ClockHandsCapabilitiesResult, ClockHandsRefusal,
  PrepareClockHandsResult, PreparedClockHands } from './author-clock-motion-types.js';

type Variant = 'outline' | 'filled';
type Variants<T> = Readonly<Partial<Record<Variant, T>>>;
type Point = readonly [number, number];
const COUNTS: Readonly<Record<string, number>> = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };
/** @internal Только compiler задаёт контуры, опору и соответствие физическому target. */
export interface CompiledClockHands {
  readonly version: 1;
  readonly law: 'joint.authored-elbow';
  readonly icon: PreparedClockHands['icon'];
  readonly variant: Variant;
  readonly polarity: 'positive' | 'negative';
  readonly coordinateSpace: 'viewBox';
  readonly bearing: Point;
  readonly viewBox: readonly [number, number, number, number];
  readonly limbs: readonly Readonly<{ id: string; commands: string; points: readonly Point[]; turnsPerHour: number }>[];
  readonly svg: string;
  readonly originalD: string;
  readonly renderTarget: PreparedClockHands['renderTarget'];
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
function refuse(code: ClockHandsRefusal['reason']['code'], message: string): ClockHandsRefusal {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
}
function select<T>(values: Variants<T>, requested: unknown): Variant | ClockHandsRefusal {
  const variant = requested === undefined ? 'outline' : requested;
  if (variant !== 'outline' && variant !== 'filled') return refuse('INVALID_REQUEST', 'Начертание: outline или filled.');
  return Object.hasOwn(values, variant) ? variant : refuse('VARIANT_UNSUPPORTED', 'Для начертания нет подготовленных стрелок.');
}

/** @internal Парсинга SVG, Boolean clipping и построения IR в кадре нет. */
export function createCompiledClockPreparation(input: Variants<CompiledClockHands>) {
  const packets = freezeTree(input), prepared: Partial<Record<Variant, PreparedClockHands | ClockHandsRefusal>> = {};
  for (const variant of ['outline', 'filled'] as const) {
    const packet = packets[variant];
    if (!packet) continue;
    const { packetSha256, ...program } = packet;
    if (packetSha256 !== sha256Hex(stableJSON(program)) || packet.version !== 1 || packet.law !== 'joint.authored-elbow' ||
        packet.variant !== variant || packet.coordinateSpace !== 'viewBox' || !['positive', 'negative'].includes(packet.polarity) || packet.bearing.length !== 2 ||
        packet.bearing.some(value => !Number.isFinite(value)) || packet.viewBox.length !== 4 ||
        packet.viewBox.some(value => !Number.isFinite(value)) || packet.viewBox[2] <= 0 || packet.viewBox[3] <= 0 ||
        packet.limbs.length !== 2 || new Set(packet.limbs.map(limb => limb.id)).size !== 2 ||
        packet.limbs.some(limb => !/^M[LCQ]+Z$/.test(limb.commands) ||
          [...limb.commands].reduce((count, command) => count + COUNTS[command]!, 0) !== limb.points.length ||
          limb.points.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value))) ||
          ![1, 1 / 12].includes(limb.turnsPerHour)) ||
        new Set(packet.limbs.map(limb => limb.turnsPerHour)).size !== 2 ||
        packet.renderTarget.attribute !== 'd' || !packet.renderTarget.selector || !packet.svg || !packet.originalD ||
        JSON.stringify(packet.renderTarget.partIds) !== JSON.stringify(packet.limbs.map(limb => limb.id))) {
      throw new TypeError('clock hands: неподтверждённый compiler packet');
    }
    if (packet.polarity === 'negative') {
      prepared[variant] = refuse('COMPOSITION_UNSUPPORTED', 'Отрицательные стрелки требуют вычитания объединения; этот target ещё не подготовлен.');
      continue;
    }
    // Синус/косинус считаются один раз на стрелку, поворачиваются готовые operands.
    const sample = (elapsedHours: number) => {
      if (typeof elapsedHours !== 'number' || !Number.isFinite(elapsedHours)) return refuse('INVALID_REQUEST', 'Elapsed hours обязан быть конечным числом.');
      const hours = elapsedHours % 12;
      if (hours === 0) return Object.freeze({ ok: true as const, elapsedHours, d: packet.originalD });
      const [cx, cy] = packet.bearing;
      let d = '';
      for (const limb of packet.limbs) {
        const radians = (limb.turnsPerHour === 1 ? hours % 1 : hours / 12) * 2 * Math.PI;
        const cosine = Math.cos(radians), sine = Math.sin(radians);
        let index = 0;
        for (const command of limb.commands) {
          d += command;
          for (let operand = 0; operand < COUNTS[command]!; operand++) {
            const point = limb.points[index++]!, x = point[0] - cx, y = point[1] - cy;
            d += `${cx + x * cosine - y * sine},${cy + x * sine + y * cosine} `;
          }
        }
      }
      return Object.freeze({ ok: true as const, elapsedHours, d });
    };
    prepared[variant] = Object.freeze({ version: 1, law: packet.law, icon: packet.icon, variant,
      svg: packet.svg, reference: 'authored-pose', parameter: 'elapsed-hours', renderTarget: packet.renderTarget, sample });
  }
  return function prepareClockHands(requested?: Variant): PrepareClockHandsResult {
    const variant = select(prepared, requested);
    if (typeof variant !== 'string') return variant;
    const result = prepared[variant]!;
    return 'ok' in result ? result : Object.freeze({ ok: true, prepared: result });
  };
}

/** @internal Metadata consumer не удерживает prepared contour operands. */
export function createCompiledClockCapabilities(input: Variants<ClockHandsCapabilities | ClockHandsRefusal>) {
  const capabilities = freezeTree(input);
  return function motionCapabilities(requested?: Variant): ClockHandsCapabilitiesResult {
    const variant = select(capabilities, requested);
    if (typeof variant !== 'string') return variant;
    const result = capabilities[variant]!;
    return 'ok' in result ? result : Object.freeze({ ok: true, capabilities: result });
  };
}
