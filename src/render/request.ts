import type { IconSymbol, IconVariant, RenderIconOptions } from './index.js';
import { opticalPosition } from './optical-grid.js';
import { resolveCalendarSymbol } from './calendar.js';
import { resolveCalendarDay } from '../core/calendar-date.js';

/** Shared admission for pure rendering and mounted motion; no discarded SVG serialization. */
export function resolveIconRequest(symbol: IconSymbol, options: RenderIconOptions) {
  if (!options || typeof options !== 'object') throw new TypeError('renderIcon options must be an object');
  let selected = symbol, variant = options.variant;
  if (options.state !== undefined) {
    const states = symbol.semantics?.states;
    const state = states && Object.hasOwn(states, options.state) ? states[options.state] : undefined;
    if (symbol.states && Object.hasOwn(symbol.states, options.state)) selected = symbol.states[options.state]!;
    else if (options.state === 'selected' || options.state === 'unselected') variant ??= options.state === 'selected' ? 'filled' : 'outline';
    else if (state) selected = state.data ? { id: state.id, data: state.data, semantics: state.semantics, outline: '', filled: '' } : symbol;
    else throw new RangeError(`symbol ${symbol.id} does not define state ${String(options.state)}`);
  }
  const dynamic = options.date !== undefined || options.timeZone !== undefined;
  if (dynamic) {
    if (!symbol.semantics?.calendar && !selected.semantics?.calendar) throw new RangeError(`Symbol ${symbol.id} does not support a calendar date`);
    if (options.date === undefined || options.timeZone === undefined) throw new TypeError('Calendar date and timeZone must be provided together');
    const { day } = resolveCalendarDay({ date: options.date, timeZone: options.timeZone });
    if (selected.semantics?.calendar) selected = resolveCalendarSymbol(selected, day);
  }
  const data = selected.data;
  if (data?.version !== 1) throw new TypeError(`symbol ${selected.id} has no compiled optical masters`);
  if (variant === undefined) variant = 'outline';
  if (variant !== 'outline' && variant !== 'filled') throw new RangeError('variant must be outline or filled');
  const size = options.size === undefined ? data.axes.opsz[1] : options.size;
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('size must be a finite positive number of CSS pixels');
  const weight = options.weight === undefined ? data.axes.weight[1] : options.weight;
  const requestedOpsz = options.opsz === undefined ? 'auto' : options.opsz;
  const opsz = requestedOpsz === 'auto' ? Math.min(data.axes.opsz[2], Math.max(data.axes.opsz[0], size)) : requestedOpsz;
  return { selected, data, variant: variant as IconVariant, size, weight, opsz,
    parts: dynamic && selected.semantics?.calendar ? selected.semantics.variants[variant].parts : undefined,
    position: opticalPosition(data.axes, weight, opsz) };
}
