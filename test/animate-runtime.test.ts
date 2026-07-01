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
import { animatableNames, animateIcon, iconClass } from '../src/animate/index.js';

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
  it('А: pulse (heart, 1 слой) → одна анимация на whole (сам svg), scale в кейфреймах', () => {
    const svg = svgFor('single');
    const h = animateIcon(svg as unknown as SVGSVGElement, {
      name: 'heart',
      matchMedia: noPreference,
    });
    expect(h.reduced).toBe(false);
    expect(svg.calls).toHaveLength(1);
    expect(svg.calls[0]!.target).toBe(svg);
    const kf = svg.calls[0]!.keyframes;
    expect(String(kf[Math.floor(kf.length / 2)]!.transform)).toContain('scale(');
    expect(svg.style['transformOrigin']).toBe('50% 50%');
  });

  it('А: bell (notifications, 2 слоя) → корпус качается вокруг подвеса, язычок вдогонку', () => {
    const svg = svgFor('bell');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'notifications', matchMedia: noPreference });
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

  it('А: wave (volume-high, 4 слоя) → рупор пульсирует, волны каскадом 0/100/200мс от рупора', () => {
    const svg = svgFor('wave');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'volume-high', matchMedia: noPreference });
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

  it('А: draw (brush) → clip-path раскрытие на whole + наклон инструмента (BL-002)', () => {
    const svg = svgFor('single');
    animateIcon(svg as unknown as SVGSVGElement, { name: 'brush', matchMedia: noPreference });
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
