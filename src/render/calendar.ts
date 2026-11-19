import type { IconSymbol, IconVariant, SymbolPart } from './index.js';

/** Date conversion happens once per request; the renderer receives only shared numeric paths. */
export function resolveCalendarSymbol(symbol: IconSymbol, day: number): IconSymbol {
  const calendar = symbol.semantics?.calendar;
  if (!calendar) throw new RangeError(`Symbol ${symbol.id} does not support a calendar date`);
  const values = day < 10 ? [day] : [Math.floor(day / 10), day % 10];
  const variants = {} as Record<IconVariant, { paths: readonly typeof calendar.digits[number][] }>;
  const semantics = {} as Record<IconVariant, { parts: SymbolPart[]; effects: {} }>;
  for (const variant of ['outline', 'filled'] as const) {
    const source = symbol.data.variants[variant].paths, shells = calendar.shells[variant];
    const layer = shells[0]!.layer!;
    variants[variant] = { paths: [...source, ...calendar.digits] };
    const digits = values.map((digit, index): SymbolPart => {
      const slot = index === 0 && values.length === 2 ? 'tens' : 'ones';
      const side = values.length === 1 ? 0 : index === 0 ? -1 : 1;
      return { id: `calendar-date-${slot}`, key: `${layer}/${calendar.key}/${slot}/${digit}/${side}`, layer,
        ...(variant === 'filled' && { negative: true }), pathIndex: source.length + digit, anchor: [12, 12],
        offsetX: { base: calendar.spacing.base * side, terms: calendar.spacing.terms.map(([term, value]) => [term, value * side]) } };
    });
    semantics[variant] = { parts: [...shells, ...digits], effects: {} };
  }
  return { ...symbol, outline: '', filled: '', data: { ...symbol.data, variants },
    semantics: { ...symbol.semantics!, variants: semantics } };
}
