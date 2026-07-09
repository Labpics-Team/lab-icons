/**
 * test/animate-runtime.test.ts — рантайм animateIcon (ch03, эпик ds-icons).
 *
 * Контракт: семантика (assignments) + хореография (generated) + слои (getBBox,
 * один раз на триггер) → WAAPI-вызовы с верными таргетами/origin/стаггером.
 * DOM фейковый (минимальный контракт LayerLike/IconRootLike) — юнит-уровень;
 * визуальная правда — демо + e2e (ch04).
 *
 * Классы: А (юнит-оркестровка по классам), Б (контракт reduced/ошибок).
 */

import { describe, expect, it } from 'vitest';
import {
  animatableNames,
  animateIcon,
  iconClass,
  type IconAnimationHandle,
} from '../src/animate/index.js';

// ─── Фейковый DOM ────────────────────────────────────────────────────────────

interface Call {
  target: FakeEl;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

class FakeEl {
  style: Record<string, string> = {};
  bbox: { x: number; y: number; width: number; height: number };
  calls: Call[];
  constructor(bbox: { x: number; y: number; width: number; height: number }, calls: Call[]) {
    this.bbox = bbox;
    this.calls = calls;
  }
  getBBox() {
    return this.bbox;
  }
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const call = { target: this, keyframes, options };
    this.calls.push(call);
    return {
      finished: Promise.resolve(),
      cancel() {
        (call as unknown as { cancelled: boolean }).cancelled = true;
      },
    } as unknown as Animation;
  }
}

class FakeSvg extends FakeEl {
  paths: FakeEl[];
  constructor(pathBBoxes: Array<{ x: number; y: number; width: number; height: number }>) {
    const calls: Call[] = [];
    super({ x: 0, y: 0, width: 24, height: 24 }, calls);
    this.paths = pathBBoxes.map((b) => new FakeEl(b, calls));
  }
  querySelectorAll(sel: string) {
    if (sel !== ':scope > path') throw new Error(`неожиданный селектор: ${sel}`);
    return this.paths as unknown as ArrayLike<Element>;
  }
}

const noPreference = () => ({ matches: false });
const reduce = (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' });

function svgFor(kind: 'bell' | 'wave' | 'single'): FakeSvg {
  if (kind === 'bell') {
    // notifications: язычок (маленький, снизу по центру) + корпус (большой)
    return new FakeSvg([
      { x: 9.2, y: 20.2, width: 5, height: 2.8 },
      { x: 2.4, y: 1, height: 20, width: 19.2 },
    ]);
  }
  if (kind === 'wave') {
    // volume-high: рупор (большой, слева) + 3 волны слева-направо
    return new FakeSvg([
      { x: 18, y: 2, width: 4, height: 20 }, // волна дальняя (правая)
      { x: 15.5, y: 5, width: 3, height: 14 }, // волна средняя
      { x: 1, y: 5, width: 10, height: 14 }, // рупор (body: макс. площадь)
      { x: 13.5, y: 8, width: 2.5, height: 8 }, // волна ближняя
    ]);
  }
  return new FakeSvg([{ x: 2, y: 2, width: 20, height: 20 }]);
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe('animateIcon — оркестровка по классам', () => {
  it('А: pulse (alert, 1 слой, без per-icon разметки) → одна анимация на whole, scale в кейфреймах', () => {
    const svg = svgFor('single');
    const h = animateIcon(svg as unknown as SVGSVGElement, {
      name: 'alert',
      matchMedia: noPreference,
    });
    expect(h.reduced).toBe(false);
    expect(svg.calls).toHaveLength(1);
    expect(svg.calls[0]!.target).toBe(svg);
    const kf = svg.calls[0]!.keyframes;
    expect(String(kf[Math.floor(kf.length / 2)]!.transform)).toContain('scale(');
    expect(svg.style['transformOrigin']).toBe('50% 50%');
  });

  it('А: bell (notifications-unread, 2 слоя, без per-icon разметки) → корпус вокруг подвеса, язычок вдогонку', () => {
    const svg = svgFor('bell');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'notifications-unread', matchMedia: noPreference });
    expect(svg.calls).toHaveLength(2);
    const [bodyCall, clapperCall] = svg.calls;
    // body = слой максимальной площади (корпус), origin 50% 8% (подвес)
    expect(bodyCall!.target).toBe(svg.paths[1]);
    expect(bodyCall!.target.style['transformOrigin']).toBe('50% 8%');
    expect(bodyCall!.target.style['transformBox']).toBe('fill-box');
    // smallest = язычок, задержка из хореографии (60мс), origin сверху
    expect(clapperCall!.target).toBe(svg.paths[0]);
    expect(clapperCall!.options.delay).toBeCloseTo(60, 6);
    // rotate в кейфреймах обоих
    expect(String(bodyCall!.keyframes[1]!.transform)).toContain('rotate(');
  });

  it('А: wave (volume-middle, 4 слоя, без per-icon разметки) → рупор пульсирует, волны каскадом 0/100/200мс', () => {
    const svg = svgFor('wave');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'volume-middle', matchMedia: noPreference });
    expect(svg.calls).toHaveLength(4);
    const bodyCall = svg.calls[0]!;
    expect(bodyCall.target).toBe(svg.paths[2]); // рупор — максимальная площадь
    // Волны отсортированы по расстоянию от рупора: ближняя → средняя → дальняя
    const waveCalls = svg.calls.slice(1);
    expect(waveCalls.map((c) => c.target)).toEqual([svg.paths[3], svg.paths[1], svg.paths[0]]);
    expect(waveCalls.map((c) => c.options.delay)).toEqual([0, 100, 200]);
    // Волны мигают непрозрачностью (variable-color паттерн)
    expect(waveCalls[0]!.keyframes.some((k) => typeof k.opacity === 'number')).toBe(true);
  });

  it('А: direction (arrow-back, dir=left) → сдвиг влево (отрицательный translate X)', () => {
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'arrow-back', matchMedia: noPreference });
    const kf = svg.calls[0]!.keyframes;
    const mid = kf[Math.floor(kf.length / 2)]!;
    const m = /translate\((-?[\d.]+)px/.exec(String(mid.transform));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(0);
  });

  it('А: draw (pencil, без per-icon разметки) → clip-path раскрытие на whole + наклон инструмента (BL-002)', () => {
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'pencil', matchMedia: noPreference });
    const clipCall = svg.calls.find((c) => c.keyframes.some((k) => 'clipPath' in k));
    expect(clipCall).toBeDefined();
    const clipKf = clipCall!.keyframes;
    // Раскрытие: right-inset 100% → 0%
    expect(String(clipKf[0]!.clipPath)).toContain('inset(0 100.00% 0 0)');
    expect(String(clipKf[clipKf.length - 1]!.clipPath)).toContain('inset(0 0.00% 0 0)');
    // Плюс transform-часть (наклон)
    expect(svg.calls.some((c) => c.keyframes.some((k) => k.transform))).toBe(true);
  });

  it('А: blink у wholeOnly (console) → wholeFallback: мягкий минимум opacity 0.35, не полное гашение', () => {
    // Mutation proof: убрать wholeFallback-ветку в resolveParts → минимум 0 → RED
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'console', matchMedia: noPreference });
    expect(svg.calls).toHaveLength(1);
    const opacities = svg.calls[0]!.keyframes
      .map((k) => k.opacity)
      .filter((o): o is number => typeof o === 'number');
    expect(Math.min(...opacities)).toBeCloseTo(0.35, 6);
  });

  it('А: iterations=Infinity перекрывает данные хореографии (ambient-луп)', () => {
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, {
      name: 'heart',
      iterations: Infinity,
      matchMedia: noPreference,
    });
    expect(svg.calls[0]!.options.iterations).toBe(Infinity);
  });
});

describe('animateIcon — фиксы фидбека владельца 2026-07-02', () => {
  it('А: pop стартует С ЕДИНИЦЫ (сквош), не с нуля — иконка не «исчезает» на hover', () => {
    // Mutation proof: вернуть scale-с-нуля в данных → первый кейфрейм scale(0 → RED
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'checkmark-circle', matchMedia: noPreference });
    const kf = svg.calls[0]!.keyframes;
    expect(String(kf[0]!.transform)).toContain('scale(1, 1)');
    // Провал сквоша ~0.86 присутствует
    const scales = kf
      .map((k) => /scale\(([\d.]+)/.exec(String(k.transform)))
      .filter(Boolean)
      .map((m) => Number(m![1]));
    expect(Math.min(...scales)).toBeLessThan(0.9);
    expect(Math.min(...scales)).toBeGreaterThan(0.7);
  });

  it('А: generic — живой bounce (треки y и scaleY), не мёртвый микропульс', () => {
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'folder', matchMedia: noPreference });
    const kf = svg.calls[0]!.keyframes;
    const transforms = kf.map((k) => String(k.transform));
    expect(transforms.some((t) => /translate\([\d.-]+px, -[\d.]+px\)/.test(t))).toBe(true); // подскок вверх
    expect(transforms.some((t) => /scale\(1, 0\.9[\d]*\)/.test(t) || /scale\(1, 0\.9\d+\)/.test(t))).toBe(
      true,
    ); // сквош по Y
    expect(svg.style['transformOrigin']).toBe('50% 100%'); // от «земли»
  });

  it('А: direction у enclosure (стрелка В круге) двигает ГЛИФ, круг стоит', () => {
    // Mutation proof: убрать glyph-ветку резолвера → едет весь svg → RED
    const svg = new FakeSvg([
      { x: 8, y: 9, width: 8, height: 6 }, // стрелка (глиф, внутри круга)
      { x: 1, y: 1, width: 22, height: 22 }, // круг (enclosure)
    ]);
    animateIcon(svg as unknown as SVGSVGElement, {
      name: 'arrow-forward-circle',
      matchMedia: noPreference,
    });
    expect(svg.calls).toHaveLength(1);
    expect(svg.calls[0]!.target).toBe(svg.paths[0]); // именно глиф
    expect(svg.paths[0]!.style['transformBox']).toBe('fill-box');
  });

  it('А: spin у слоистого без per-icon разметки (timer) вращает внутренний глиф', () => {
    const svg = new FakeSvg([
      { x: 7, y: 7, width: 10, height: 10 }, // игла внутри
      { x: 1, y: 1, width: 22, height: 22 }, // корпус
    ]);
    animateIcon(svg as unknown as SVGSVGElement, { name: 'timer', matchMedia: noPreference });
    expect(svg.calls[0]!.target).toBe(svg.paths[0]);
    expect(String(svg.calls[0]!.keyframes.at(-1)!.transform)).toContain('rotate(360deg)');
  });

  it('Б: getBBox бросает (detached/hidden) → деградация в whole, БЕЗ исключения наружу', () => {
    // Mutation proof: убрать try/catch в collectLayers → throw наружу → RED
    const svg = svgFor('bell');
    for (const p of svg.paths) {
      p.getBBox = () => {
        throw new Error('нет layout');
      };
    }
    let h: IconAnimationHandle | undefined;
    expect(() => {
      h = animateIcon(svg as unknown as SVGSVGElement, {
        name: 'notifications-unread',
        matchMedia: noPreference,
      });
    }).not.toThrow();
    // Слои неизмеримы → анимация целиком (body-часть на whole)
    expect(h!.animations.length).toBeGreaterThan(0);
    expect(svg.calls.every((c) => c.target === svg)).toBe(true);
  });

  it('А: хендл несёт pause/play/reverse (будущие hover-триггеры)', () => {
    const svg = svgFor('single');
    const h = animateIcon(svg as unknown as SVGSVGElement, { name: 'heart', matchMedia: noPreference });
    expect(typeof h.pause).toBe('function');
    expect(typeof h.play).toBe('function');
    expect(typeof h.reverse).toBe('function');
  });
});

describe('animateIcon — контракт reduced-motion и ошибок', () => {
  it('Б: reduced-motion → ноль animate-вызовов, reduced=true, finished резолвится', async () => {
    const svg = svgFor('bell');
    const h = animateIcon(svg as unknown as SVGSVGElement, {
      name: 'notifications',
      matchMedia: reduce,
    });
    expect(h.reduced).toBe(true);
    expect(svg.calls).toHaveLength(0);
    await h.finished;
  });

  it('Б: неизвестное имя → понятная ошибка', () => {
    const svg = svgFor('single');
    expect(() =>
      animateIcon(svg as unknown as SVGSVGElement, { name: 'no-such-icon', matchMedia: noPreference }),
    ).toThrow(/неизвестное имя иконки/);
  });

  it('Б: cancel() отменяет все анимации', () => {
    const svg = svgFor('wave');
    const h = animateIcon(svg as unknown as SVGSVGElement, {
      name: 'volume-high',
      matchMedia: noPreference,
    });
    h.cancel();
    expect(h.animations.length).toBe(4);
  });

  it('Б: покрытие API — animatableNames 222, iconClass работает', () => {
    expect(animatableNames()).toHaveLength(222);
    expect(iconClass('notifications')).toBe('bell');
    expect(iconClass('brush')).toBe('draw');
    expect(iconClass('no-such')).toBeUndefined();
  });
});

// ─── Per-icon данные (semantics/layers.json → icon-choreographies, реврейм) ──

/** history: кольцо-стрелка (большое) + стрелки часов (малый слой внутри). */
function svgHistory(): FakeSvg {
  return new FakeSvg([
    { x: 1, y: 1.4, width: 22, height: 21.2 },
    { x: 11.1, y: 6, width: 6.2, height: 8.1 },
  ]);
}

describe('animateIcon — per-icon разметка (классы багов A/C/D владельца)', () => {
  it('А (класс A): history → стрелки со спрингом вокруг узла + вздрагивание циферблата', () => {
    const svg = svgHistory();
    animateIcon(svg as unknown as SVGSVGElement, { name: 'history', matchMedia: noPreference });
    expect(svg.calls).toHaveLength(2);
    const hands = svg.calls.find((c) => c.target === svg.paths[1])!;
    expect(hands.target.style['transformBox']).toBe('view-box');
    expect(hands.target.style['transformOrigin']).toBe('12.4px 13.2px');
    // отмотка назад: отрицательный пик rotate, identity-края (v6: спринг, не -360)
    const angles = hands.keyframes
      .map((k) => {
        const t = String(k.transform);
        const i = t.indexOf('rotate(');
        return i === -1 ? null : Number.parseFloat(t.slice(i + 7));
      })
      .filter((v): v is number => v !== null);
    expect(Math.min(...angles)).toBeLessThan(-20);
    expect(angles[angles.length - 1]).toBe(0);
    // циферблат вздрагивает в противоход
    const ring = svg.calls.find((c) => c.target === svg.paths[0])!;
    expect(ring.target.style['transformOrigin']).toBe('12.36px 12px');
  });

  it('А (класс D): hourglass → флип трёх частей синхронно, кучи песка дышат scaleY', () => {
    const svg = new FakeSvg([
      { x: 9.6, y: 6.9, width: 4.8, height: 3.7 }, // верхняя куча
      { x: 11.5, y: 10.6, width: 1.2, height: 2.8 }, // струйка
      { x: 8.2, y: 13, width: 7.6, height: 6 }, // нижняя куча
      { x: 4.9, y: 1.7, width: 14.2, height: 20.6 }, // рамка
    ]);
    animateIcon(svg as unknown as SVGSVGElement, { name: 'hourglass', matchMedia: noPreference });
    expect(svg.calls).toHaveLength(4);
    // все части — вокруг центра флипа, синхронно (без стаггера)
    for (const c of svg.calls) {
      expect(c.target.style['transformOrigin']).toBe('12px 12px');
      expect(c.options.delay).toBe(svg.calls[0]!.options.delay);
      expect(c.keyframes.some((k) => String(k.transform).includes('rotate(180'))).toBe(true);
    }
    // кучи несут scaleY-дыхание уровней, струйка и рамка — нет
    // presetToWaapi сливает scale и scaleY в scale(a, b): ищем неравномерный масштаб
    const hasScaleY = (el: FakeEl) =>
      svg.calls.some((c) =>
        c.target === el &&
        c.keyframes.some((k) => {
          const m = /scale\(([-\d.]+), ([-\d.]+)\)/.exec(String(k.transform));
          return m !== null && Math.abs(Number(m[1]) - Number(m[2])) > 0.01;
        }),
      );
    expect(hasScaleY(svg.paths[0]!)).toBe(true);
    expect(hasScaleY(svg.paths[2]!)).toBe(true);
    expect(hasScaleY(svg.paths[1]!)).toBe(false);
    expect(hasScaleY(svg.paths[3]!)).toBe(false);
  });

  it('А: volume-high → волны в явном порядке данных (ближняя→дальняя) со стаггером 90мс от устья', () => {
    const svg = svgFor('wave');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'volume-high', matchMedia: noPreference });
    const waveCalls = svg.calls.filter((c) => c.target !== svg.paths[2]);
    expect(waveCalls.map((c) => c.target)).toEqual([svg.paths[3], svg.paths[1], svg.paths[0]]);
    expect(waveCalls.map((c) => Number(c.options.delay))).toEqual([0, 90, 180]);
    // излучение: волны рождаются у общего якоря-устья, а не мерцают по своим центрам
    expect(waveCalls[0]!.target.style['transformOrigin']).toBe('11.5px 12px');
    expect(waveCalls[0]!.keyframes[0]!.opacity).toBeLessThan(1);
  });

  it('А (класс C): camera-reverse filled → ЗАМЕНА движения (сквош), не вращение целого', () => {
    const outline = new FakeSvg([
      { x: 5.3, y: 6.9, width: 13.4, height: 10.1 },
      { x: 1, y: 2, width: 22, height: 18 },
    ]);
    animateIcon(outline as unknown as SVGSVGElement, {
      name: 'camera-reverse',
      matchMedia: noPreference,
    });
    expect(outline.calls).toHaveLength(1);
    expect(outline.calls[0]!.target).toBe(outline.paths[0]);
    // аккуратный подворот со спрингом: rotate с пиком и identity-краями, без scale
    expect(
      outline.calls[0]!.keyframes.some((k) => String(k.transform).includes('rotate(')),
    ).toBe(true);
    expect(
      outline.calls[0]!.keyframes.some((k) => String(k.transform).includes('scale(')),
    ).toBe(false);

    const filled = new FakeSvg([{ x: 1, y: 2, width: 22, height: 18 }]);
    animateIcon(filled as unknown as SVGSVGElement, {
      name: 'camera-reverse',
      variant: 'filled',
      matchMedia: noPreference,
    });
    expect(filled.calls).toHaveLength(1);
    expect(filled.calls[0]!.target).toBe(filled.paths[0]);
    expect(filled.calls[0]!.keyframes.some((k) => String(k.transform).includes('rotate('))).toBe(
      false,
    );
    expect(filled.calls[0]!.keyframes.some((k) => String(k.transform).includes('scale('))).toBe(
      true,
    );
  });

  it('А (BL-009): checkmark → «поставили галочку» спрингом на слое, БЕЗ клипа (клип заморожен)', () => {
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'checkmark', matchMedia: noPreference });
    expect(svg.calls.filter((c) => c.target === svg)).toHaveLength(0);
    const layerCalls = svg.calls.filter((c) => c.target === svg.paths[0]);
    expect(layerCalls).toHaveLength(1);
    expect(layerCalls[0]!.keyframes.some((k) => 'clipPath' in k)).toBe(false);
    expect(layerCalls[0]!.keyframes.some((k) => String(k.transform).includes('rotate('))).toBe(true);
    expect(layerCalls[0]!.target.style['transformOrigin']).toBe('10.9px 16.3px');
  });

  it('Б: слоёв меньше, чем требует разметка → честный фолбэк в классовую хореографию', () => {
    // history требует path index 1; однослойный svg → классовый spin на whole
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'history', matchMedia: noPreference });
    expect(svg.calls).toHaveLength(1);
    expect(svg.calls[0]!.target).toBe(svg);
  });

  it('Б: reduced-motion действует и на per-icon путь', async () => {
    const svg = svgHistory();
    const h = animateIcon(svg as unknown as SVGSVGElement, { name: 'history', matchMedia: reduce });
    expect(h.reduced).toBe(true);
    expect(svg.calls).toHaveLength(0);
    await h.finished;
  });
});
