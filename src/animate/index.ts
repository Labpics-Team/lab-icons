/**
 * animate/index.ts — рантайм «анимации от смысла» @labpics/icons/animate.
 *
 * Иконка оживает согласно своему семантическому классу (SF-Symbols-подход):
 * semantics/assignments.json говорит ЧТО означает иконка, прекомпилированные
 * хореографии (choreographies.generated.json, из @labpics/motion/presets)
 * говорят КАК это движется, рантайм резолвит СЛОИ (path) по ролям и запускает
 * WAAPI-анимации (композитор, off-main-thread).
 *
 * Инварианты:
 *   1. Zero runtime-dep: хореографии прекомпилированы, WAAPI нативный.
 *   2. Роли слоёв резолвятся детерминированно из одноразового getBBox()
 *      при триггере (не в кадровом цикле; рантайм по определению браузерный).
 *   3. Reduced-motion CHARACTER-switch: статичная иконка = валидная
 *      нейтральная поза (все хореографии identity-краевые) — анимации
 *      не создаются, хендл честно сообщает reduced=true.
 *   4. SSR-safe: модуль не трогает DOM/window на верхнем уровне.
 *   5. Пер-слойные трансформы: transform-box fill-box + transform-origin
 *      из хореографии (проценты от bbox слоя — без вычисления координат).
 */

import assignmentsJson from '../../semantics/assignments.json' with { type: 'json' };
import choreographiesJson from './choreographies.generated.json' with { type: 'json' };

// ─── Типы данных (форма generated-файлов) ────────────────────────────────────

/** Направление для класса direction (закрытый перечень semantics.json). */
export type IconDirection = 'up' | 'down' | 'left' | 'right' | 'up-down' | 'left-right';

interface SemanticEntry {
  readonly class: string;
  readonly params?: { readonly dir?: IconDirection };
  readonly wholeOnly?: true;
}

interface WaapiKeyframeData {
  readonly offset: number;
  readonly transform?: string;
  readonly opacity?: number;
}

interface WaapiTimingData {
  readonly duration: number;
  readonly delay: number;
  readonly iterations: number;
  readonly direction: 'normal' | 'alternate';
  readonly fill: 'both';
  readonly easing: 'linear';
}

type PartRole = 'whole' | 'body' | 'rest' | 'smallest';

interface ChoreographyPart {
  readonly role: PartRole;
  readonly origin: string;
  readonly keyframes: readonly WaapiKeyframeData[];
  readonly timing: WaapiTimingData;
  readonly staggerGapMs?: number;
}

interface ClipData {
  readonly progressTrack: { readonly offsets: readonly number[]; readonly values: readonly number[] };
  readonly timing: WaapiTimingData;
}

interface Choreography {
  readonly parts?: readonly ChoreographyPart[];
  readonly byDir?: Readonly<Record<IconDirection, readonly ChoreographyPart[]>>;
  readonly wholeFallback?: readonly ChoreographyPart[];
  readonly clip?: ClipData;
}

const assignments = assignmentsJson as Readonly<Record<string, SemanticEntry>>;
const choreographies = (choreographiesJson as {
  choreographies: Readonly<Record<string, Choreography>>;
}).choreographies;

// ─── Публичный API ───────────────────────────────────────────────────────────

export interface AnimateIconOptions {
  /** kebab-имя иконки ('notifications', 'volume-high'). */
  readonly name: string;
  /**
   * Повторы: 1 (по умолчанию) — разовый смысловой акцент;
   * Infinity — ambient-луп (курсор, дыхание). Перекрывает данные хореографии.
   */
  readonly iterations?: number;
  /** Injectable matchMedia (тесты/SSR). По умолчанию window.matchMedia. */
  readonly matchMedia?: ((query: string) => { matches: boolean }) | undefined;
}

/** Хендл запущенной анимации иконки. */
export interface IconAnimationHandle {
  /** true — сработал reduced-motion CHARACTER-switch: иконка осталась статичной. */
  readonly reduced: boolean;
  /** Запущенные WAAPI-анимации (пусто при reduced). */
  readonly animations: readonly Animation[];
  /** Резолвится по завершении всех анимаций (сразу — при reduced). */
  readonly finished: Promise<void>;
  /** Отменить все анимации (слои вернутся к статике). */
  cancel(): void;
}

/** Слой иконки, как его видит резолвер ролей (минимальный контракт DOM). */
interface LayerLike {
  getBBox(): { x: number; y: number; width: number; height: number };
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation;
  style: CSSStyleDeclaration;
}

/** Корень иконки: слои + собственная анимируемость (whole/clip). */
interface IconRootLike {
  querySelectorAll(selector: string): ArrayLike<Element>;
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation;
  style: CSSStyleDeclaration;
}

/**
 * Запускает семантическую анимацию inline-SVG иконки.
 *
 * @param svg  Корневой <svg> иконки @labpics/icons (path-слои — прямые дети).
 * @throws Error если имя неизвестно семантике (опечатка/рассинхрон версий).
 */
export function animateIcon(svg: SVGSVGElement, opts: AnimateIconOptions): IconAnimationHandle {
  const semantic = assignments[opts.name];
  if (!semantic) {
    throw new Error(
      `@labpics/icons/animate: неизвестное имя иконки "${opts.name}" — нет в semantics/assignments.json`,
    );
  }
  const choreography = choreographies[semantic.class];
  if (!choreography) {
    throw new Error(
      `@labpics/icons/animate: класс "${semantic.class}" не имеет хореографии (рассинхрон generated-данных)`,
    );
  }

  // Reduced-motion CHARACTER-switch: статичная иконка = нейтральная поза.
  const mm = opts.matchMedia ?? (typeof matchMedia !== 'undefined' ? matchMedia : undefined);
  if (prefersReduced(mm)) {
    return {
      reduced: true,
      animations: [],
      finished: Promise.resolve(),
      cancel() {},
    };
  }

  const root = svg as unknown as IconRootLike;
  const layers = collectLayers(root);
  const layered = layers.length >= 2 && semantic.wholeOnly !== true;
  const parts = resolveParts(choreography, semantic, layered);
  const animations: Animation[] = [];

  for (const part of parts) {
    const targets = resolveRole(part.role, root, layers, layered);
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      applyOrigin(target, part.role, part.origin);
      const staggerDelay = (part.staggerGapMs ?? 0) * i;
      animations.push(
        target.animate(part.keyframes as unknown as Keyframe[], {
          duration: part.timing.duration,
          delay: part.timing.delay + staggerDelay,
          iterations: opts.iterations ?? part.timing.iterations,
          direction: part.timing.direction,
          fill: part.timing.fill,
          easing: part.timing.easing,
        }),
      );
    }
  }

  // Класс draw: полотно «рисуется» — clip-path раскрытие слева направо (BL-002).
  if (choreography.clip) {
    const { progressTrack, timing } = choreography.clip;
    const clipKeyframes: Keyframe[] = progressTrack.offsets.map((offset, i) => ({
      offset,
      clipPath: `inset(0 ${((1 - progressTrack.values[i]!) * 100).toFixed(2)}% 0 0)`,
    }));
    animations.push(
      root.animate(clipKeyframes, {
        duration: timing.duration,
        delay: timing.delay,
        iterations: opts.iterations ?? timing.iterations,
        direction: timing.direction,
        fill: timing.fill,
        easing: timing.easing,
      }),
    );
  }

  return {
    reduced: false,
    animations,
    finished: Promise.all(animations.map((a) => a.finished)).then(() => undefined),
    cancel() {
      for (const a of animations) a.cancel();
    },
  };
}

/** Список имён, покрытых семантикой (диагностика/демо). */
export function animatableNames(): readonly string[] {
  return Object.keys(assignments);
}

/** Семантический класс иконки (диагностика/демо). */
export function iconClass(name: string): string | undefined {
  return assignments[name]?.class;
}

// ─── Внутреннее ──────────────────────────────────────────────────────────────

function prefersReduced(mm: ((q: string) => { matches: boolean }) | undefined): boolean {
  if (typeof mm !== 'function') return false;
  try {
    return mm('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface MeasuredLayer {
  readonly el: LayerLike;
  readonly area: number;
  readonly cx: number;
  readonly cy: number;
}

function collectLayers(root: IconRootLike): MeasuredLayer[] {
  const paths = root.querySelectorAll(':scope > path');
  const layers: MeasuredLayer[] = [];
  for (let i = 0; i < paths.length; i++) {
    const el = paths[i] as unknown as LayerLike;
    const b = el.getBBox();
    layers.push({
      el,
      area: b.width * b.height,
      cx: b.x + b.width / 2,
      cy: b.y + b.height / 2,
    });
  }
  return layers;
}

/**
 * Выбор набора частей: направление / wholeOnly-фолбэк.
 * У не-слоистой иконки хореография с отдельным wholeFallback (blink: мягкий
 * минимум 0.35 вместо полного гашения курсора) подставляет его целиком.
 */
function resolveParts(
  choreography: Choreography,
  semantic: SemanticEntry,
  layered: boolean,
): readonly ChoreographyPart[] {
  if (choreography.byDir) {
    const dir = semantic.params?.dir ?? 'right';
    return choreography.byDir[dir] ?? choreography.byDir.right!;
  }
  if (!layered && choreography.wholeFallback) return choreography.wholeFallback;
  return choreography.parts ?? [];
}

/**
 * Роль → целевые элементы. Слоистые роли деградируют в whole честно:
 * у одно-слойных/wholeOnly иконок нет отделимого суб-элемента — движется
 * вся иконка; каскадная роль rest при деградации опускается (не дублировать
 * whole дважды).
 */
function resolveRole(
  role: PartRole,
  root: IconRootLike,
  layers: readonly MeasuredLayer[],
  layered: boolean,
): Array<LayerLike | IconRootLike> {
  if (role === 'whole' || !layered) {
    // rest у не-слоистой иконки схлопывать в whole нельзя дважды — каскадная
    // часть при деградации опускается, остаётся акцент body→whole.
    if (role === 'rest' && !layered) return [];
    return [root];
  }
  const byArea = [...layers].sort((a, b) => b.area - a.area);
  if (role === 'body') return [byArea[0]!.el];
  if (role === 'smallest') return [byArea[byArea.length - 1]!.el];
  // rest: все кроме body, каскад от ближнего к дальнему относительно body.
  const body = byArea[0]!;
  return byArea
    .slice(1)
    .map((l) => ({ l, d: (l.cx - body.cx) ** 2 + (l.cy - body.cy) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .map(({ l }) => l.el);
}

function applyOrigin(target: LayerLike | IconRootLike, role: PartRole, origin: string): void {
  const style = target.style as CSSStyleDeclaration & { transformBox?: string };
  if (role !== 'whole') {
    style.transformBox = 'fill-box';
  }
  style.transformOrigin = origin;
}
