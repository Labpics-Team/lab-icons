/** Отдельный diagnostic: перехват freeze не входит в latency/heap observations. */
export async function observeNativeStaticLifecycle(loadSymbol, expectedStatic) {
  const descriptor = Object.getOwnPropertyDescriptor(Object, 'freeze');
  const freezes = { import: 0, capabilities: 0, glyph: 0, warm: 0, explicitRequest: 0 };
  let phase = 'import';
  const observeFreeze = function freeze(value) {
    freezes[phase]++;
    return descriptor.value(value);
  };
  Object.defineProperty(Object, 'freeze', { ...descriptor, value: observeFreeze });
  const require = (condition, message) => {
    if (!condition) throw new Error(`native static lifecycle: ${message}`);
  };
  try {
    const api = await loadSymbol();
    require(Object.freeze === observeFreeze, 'observer заменён во время import');
    require(freezes.import === 0, 'static import замораживает неиспользуемые данные');
    for (const variant of ['outline', 'filled']) {
      require(typeof api[variant] === 'string' && api[variant] === expectedStatic[variant], `${variant}: изменён static SVG`);
    }
    phase = 'capabilities';
    const caps = api.glyphCapabilities();
    const filledCaps = api.glyphCapabilities('filled');
    require(freezes.capabilities > 0 && Object.isFrozen(caps) && Object.isFrozen(filledCaps), 'first capabilities не возвращает frozen snapshots');
    phase = 'glyph';
    const glyph = api.glyph();
    const filledGlyph = api.glyph({ variant: 'filled' });
    require(freezes.glyph > 0 && Object.isFrozen(glyph) && Object.isFrozen(filledGlyph), 'first glyph не возвращает frozen snapshots');
    phase = 'warm';
    require(api.glyph() === glyph, 'warm glyph теряет identity');
    require(api.glyphCapabilities() === caps && api.glyphCapabilities('filled') === filledCaps, 'warm capabilities теряет identity');
    require(freezes.warm === 0, 'warm consumer повторяет freeze');
    // Общий parser вправе заморозить разобранный explicit request; это не IR rebuild.
    phase = 'explicitRequest';
    require(api.glyph({ variant: 'filled' }) === filledGlyph, 'explicit request теряет identity');
    require(Object.freeze === observeFreeze, 'observer заменён во время first use');
    return { verdict: 'PASS', freezes, scope: 'freeze calls in isolated native consumer; not allocation counts or timing' };
  } finally {
    Object.defineProperty(Object, 'freeze', descriptor);
  }
}
