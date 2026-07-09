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
import iconChoreographiesJson from './icon-choreographies.generated.json' with { type: 'json' };

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

type PartRole = 'whole' | 'glyph' | 'body' | 'rest' | 'smallest';

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

/**
 * Per-icon хореография (semantics/layers.json → generated): явные path-индексы
 * и якорь ТОЧКОЙ в координатах viewBox — оптическая ось вращения из данных,
 * не из bbox-эвристики (классы багов A/C/D владельца, реврейм BL-004/BL-005).
 */
interface IconPartData {
  readonly paths: readonly number[];
  readonly anchor: readonly number[];
  readonly keyframes: readonly WaapiKeyframeData[];
  readonly timing: WaapiTimingData;
  readonly staggerGapMs?: number;
}

interface IconClipData {
  readonly keyframes: ReadonlyArray<{ readonly offset: number; readonly clipPath: string }>;
  readonly timing: WaapiTimingData;
  /**
   * Индекс слоя-цели. Для clip-path: path() обязателен: координаты path()
   * пиксельные и читаются в юнитах слоя (fill-box), а на корне-html-боксе
   * они зависели бы от отрендеренного размера иконки. Без path — корень
   * (inset/polygon в процентах).
   */
  readonly path?: number;
}

/**
 * SMIL-морф формы слоя (BL-007: «песок переливается»). WAAPI морфить d не
 * умеет кросс-браузерно (CSS-свойство d отсутствует в WebKit), SMIL
 * <animate attributeName="d"> работает во всех движках; структуру команд
 * форм гарантирует генератор + гейт check-layers.
 */
interface IconMorphData {
  readonly path: number;
  readonly values: readonly string[];
  readonly keyTimes: readonly number[];
  readonly keySplines?: readonly string[];
  readonly durationMs: number;
}

interface IconChoreography {
  readonly parts: readonly IconPartData[];
  readonly clip?: IconClipData;
  readonly morphs?: readonly IconMorphData[];
}

const assignments = assignmentsJson as Readonly<Record<string, SemanticEntry>>;
const choreographies = (choreographiesJson as {
  choreographies: Readonly<Record<string, Choreography>>;
}).choreographies;
const iconChoreographies = (iconChoreographiesJson as unknown as {
  icons: Readonly<Record<string, Partial<Record<IconVariant, IconChoreography>>>>;
}).icons;

// ─── Публичный API ───────────────────────────────────────────────────────────

/** Вариант начертания иконки — у каждого своя per-icon разметка слоёв. */
export type IconVariant = 'outline' | 'filled';

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
  /**
   * Начертание отрендеренного svg: per-icon разметка слоёв различает
   * Outline/Filled (path-индексы и деградации разные). По умолчанию 'outline'.
   */
  readonly variant?: IconVariant;
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
  /** Поставить все анимации на паузу (hover-leave и т.п.). */
  pause(): void;
  /** Возобновить после pause(). */
  play(): void;
  /** Развернуть направление всех анимаций (hover-leave с откатом). */
  reverse(): void;
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
      pause() {},
      play() {},
      reverse() {},
    };
  }

  const root = svg as unknown as IconRootLike;
  // Приоритет — per-icon разметка (точные слои и якоря из данных); классовая
  // хореография с гео-эвристиками остаётся фолбэком для неразмеченных иконок
  // и для DOM, где слоёв меньше, чем требует разметка (честная деградация).
  const perIcon = iconChoreographies[opts.name]?.[opts.variant ?? 'outline'];
  const perIconPaths = perIcon ? perIconApplicableLayers(perIcon, root) : null;
  const animations: Animation[] =
    perIcon && perIconPaths
      ? animatePerIcon(perIcon, perIconPaths, root, opts)
      : animateByClass(choreography, semantic, root, opts);
  const morphCleanups: Array<() => void> =
    perIcon && perIconPaths && perIcon.morphs
      ? startMorphs(perIcon.morphs, perIconPaths, opts)
      : [];

  // Все хореографии identity-краевые: cancel после естественного завершения
  // визуально бесшовен и освобождает композитор от завершённых Animation
  // (важно при десятках hover-иконок). allSettled: ручной cancel() реджектит
  // WAAPI a.finished — хендловый finished при этом всё равно резолвится
  // («всё закончилось»), а повторная очистка не выполняется.
  // Морф-элементы SMIL снимаются вместе с анимациями (fill=remove + remove()).
  const cleanupMorphs = () => {
    for (const cleanup of morphCleanups) cleanup();
  };
  const finished = Promise.allSettled(animations.map((a) => a.finished)).then((results) => {
    if (results.every((r) => r.status === 'fulfilled')) {
      for (const a of animations) a.cancel();
      cleanupMorphs();
    }
  });
  const smil = svg as unknown as { pauseAnimations?: () => void; unpauseAnimations?: () => void };

  return {
    reduced: false,
    animations,
    finished,
    cancel() {
      for (const a of animations) a.cancel();
      cleanupMorphs();
    },
    pause() {
      for (const a of animations) a.pause();
      smil.pauseAnimations?.();
    },
    play() {
      for (const a of animations) a.play();
      smil.unpauseAnimations?.();
    },
    reverse() {
      // SMIL-морф не реверсится — реверс применяется к WAAPI-части
      // (морф identity-краевой, расхождение краёв невозможно).
      for (const a of animations) a.reverse();
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

/** timing из данных + стаггер + перекрытие iterations → опции WAAPI. */
function waapiOptions(
  timing: WaapiTimingData,
  staggerDelayMs: number,
  iterations: number | undefined,
): KeyframeAnimationOptions {
  return {
    duration: timing.duration,
    delay: timing.delay + staggerDelayMs,
    iterations: iterations ?? timing.iterations,
    direction: timing.direction,
    fill: timing.fill,
    easing: timing.easing,
  };
}

/**
 * Слои для per-icon разметки: у DOM должно хватать path-слоёв на максимальный
 * индекс данных. Не хватает (svg обёрнут/урезан/не тот вариант с иным числом
 * слоёв) → null: вызывающий уходит в классовый фолбэк, а не двигает не те слои.
 */
function perIconApplicableLayers(
  choreo: IconChoreography,
  root: IconRootLike,
): ArrayLike<Element> | null {
  const paths = root.querySelectorAll(':scope > path');
  let maxIndex = choreo.clip?.path ?? -1;
  for (const part of choreo.parts) {
    for (const idx of part.paths) if (idx > maxIndex) maxIndex = idx;
  }
  return paths.length > maxIndex ? paths : null;
}

/**
 * Per-icon путь: слои и якоря — из данных. transform-box: view-box + якорь
 * в px координатах viewBox = оптическая ось (центр окружности, узел стрелок,
 * подвес колокола), НЕ процент от bbox слоя. getBBox не нужен вовсе.
 */
function animatePerIcon(
  choreo: IconChoreography,
  paths: ArrayLike<Element>,
  root: IconRootLike,
  opts: AnimateIconOptions,
): Animation[] {
  const animations: Animation[] = [];
  for (const part of choreo.parts) {
    for (let i = 0; i < part.paths.length; i++) {
      const el = paths[part.paths[i]!] as unknown as LayerLike;
      const style = el.style as CSSStyleDeclaration & { transformBox?: string };
      style.transformBox = 'view-box';
      style.transformOrigin = `${part.anchor[0]}px ${part.anchor[1]}px`;
      animations.push(
        el.animate(
          part.keyframes as unknown as Keyframe[],
          waapiOptions(part.timing, (part.staggerGapMs ?? 0) * i, opts.iterations),
        ),
      );
    }
  }
  // Draw-on: глиф «рисуется» — готовые clip-path кейфреймы (BL-002/BL-007).
  // Лента вдоль направляющей мазка (path-координаты) живёт на СЛОЕ,
  // процентные inset/polygon — на корне.
  if (choreo.clip) {
    const clipTarget =
      choreo.clip.path !== undefined
        ? (paths[choreo.clip.path] as unknown as LayerLike)
        : root;
    animations.push(
      clipTarget.animate(
        choreo.clip.keyframes as unknown as Keyframe[],
        waapiOptions(choreo.clip.timing, 0, opts.iterations),
      ),
    );
  }
  return animations;
}

/** Минимальный контракт SMIL <animate> (браузерный SVGAnimateElement). */
interface SmilAnimateLike {
  setAttribute(name: string, value: string): void;
  beginElement(): void;
  remove(): void;
}

/**
 * Запускает SMIL-морфы формы. SSR/тест-безопасно: без document или без
 * appendChild у слоя морф честно пропускается (transform-хореография
 * продолжает работать — прогрессивная деградация).
 */
function startMorphs(
  morphs: readonly IconMorphData[],
  paths: ArrayLike<Element>,
  opts: AnimateIconOptions,
): Array<() => void> {
  if (typeof document === 'undefined') return [];
  const cleanups: Array<() => void> = [];
  for (const morph of morphs) {
    const target = paths[morph.path] as unknown as {
      appendChild?: (el: unknown) => void;
    };
    if (!target || typeof target.appendChild !== 'function') continue;
    const el = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'animate',
    ) as unknown as SmilAnimateLike;
    el.setAttribute('attributeName', 'd');
    el.setAttribute('values', morph.values.join(';'));
    el.setAttribute('keyTimes', morph.keyTimes.join(';'));
    if (morph.keySplines) {
      el.setAttribute('calcMode', 'spline');
      el.setAttribute('keySplines', morph.keySplines.join(';'));
    }
    el.setAttribute('dur', `${morph.durationMs}ms`);
    el.setAttribute('begin', 'indefinite');
    el.setAttribute('fill', 'remove');
    if (opts.iterations === Infinity) el.setAttribute('repeatCount', 'indefinite');
    target.appendChild(el);
    el.beginElement();
    cleanups.push(() => el.remove());
  }
  return cleanups;
}

/** Классовый путь (фолбэк): роли слоёв по геометрии, origin в % от fill-box. */
function animateByClass(
  choreography: Choreography,
  semantic: SemanticEntry,
  root: IconRootLike,
  opts: AnimateIconOptions,
): Animation[] {
  const layers = collectLayers(root);
  const layered = layers.length >= 2 && semantic.wholeOnly !== true;
  const parts = resolveParts(choreography, semantic, layered);
  const animations: Animation[] = [];

  for (const part of parts) {
    const targets = resolveRole(part.role, root, layers, layered);
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      applyOrigin(target, target !== (root as unknown), part.origin);
      animations.push(
        target.animate(
          part.keyframes as unknown as Keyframe[],
          waapiOptions(part.timing, (part.staggerGapMs ?? 0) * i, opts.iterations),
        ),
      );
    }
  }

  // Класс draw: clip-path раскрытие слева направо (BL-002).
  if (choreography.clip) {
    const { progressTrack, timing } = choreography.clip;
    const clipKeyframes: Keyframe[] = progressTrack.offsets.map((offset, i) => ({
      offset,
      clipPath: `inset(0 ${((1 - progressTrack.values[i]!) * 100).toFixed(2)}% 0 0)`,
    }));
    animations.push(root.animate(clipKeyframes, waapiOptions(timing, 0, opts.iterations)));
  }
  return animations;
}

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
  readonly bbox: { x: number; y: number; width: number; height: number };
}

/**
 * Слои иконки. Инвариант разметки: path — ПРЯМЫЕ дети svg (наши иконки
 * плоские; обёртка в <g> честно деградирует в whole-анимацию).
 * getBBox() на detached/скрытом SVG бросает или даёт нули (браузерозависимо) —
 * неизмеримый слой отбрасывается, при нуле измеримых иконка анимируется
 * целиком (whole): деградация вместо исключения из публичного API.
 */
function collectLayers(root: IconRootLike): MeasuredLayer[] {
  const paths = root.querySelectorAll(':scope > path');
  const layers: MeasuredLayer[] = [];
  for (let i = 0; i < paths.length; i++) {
    const el = paths[i] as unknown as LayerLike;
    let b: { x: number; y: number; width: number; height: number };
    try {
      b = el.getBBox();
    } catch {
      continue;
    }
    if (!(b.width > 0 && b.height > 0)) continue;
    layers.push({
      el,
      area: b.width * b.height,
      cx: b.x + b.width / 2,
      cy: b.y + b.height / 2,
      bbox: b,
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
  if (role === 'glyph') {
    // Глиф внутри enclosure (стрелка В круге, игла В компасе): существенно
    // меньший слой (≤50% площади), чей центр лежит внутри bbox наибольшего.
    // Иначе — вся иконка (обычная стрелка без круга движется целиком).
    const enclosure = byArea[0]!;
    const glyph = byArea[byArea.length - 1]!;
    const e = enclosure.bbox;
    const inside =
      glyph.area <= enclosure.area * 0.5 &&
      glyph.cx >= e.x &&
      glyph.cx <= e.x + e.width &&
      glyph.cy >= e.y &&
      glyph.cy <= e.y + e.height;
    return inside ? [glyph.el] : [root];
  }
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

/** fill-box ставится только НА СЛОЙ (path); корневой svg живёт в border-box. */
function applyOrigin(target: LayerLike | IconRootLike, isLayer: boolean, origin: string): void {
  const style = target.style as CSSStyleDeclaration & { transformBox?: string };
  if (isLayer) {
    style.transformBox = 'fill-box';
  }
  style.transformOrigin = origin;
}
