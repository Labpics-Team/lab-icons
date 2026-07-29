/**
 * system/registry.js — реестр объявленных глифов.
 *
 * Глиф в этой системе — не файл и не набор узлов, а ДЕКЛАРАЦИЯ: закон словами
 * плюс построитель из токенов. Файл — производное. Поэтому каждый глиф обязан
 * предъявить `law`: строку, объясняющую конструкцию так, чтобы её можно было
 * оспорить. Декларация без закона не принимается — она бы означала, что
 * числа взялись из ниоткуда.
 */

import { resolve } from './tokens.js';

/** @type {Map<string, object>} */
export const glyphs = new Map();

/**
 * @param {string} name
 * @param {{
 *   law: string,
 *   outline: (t:object, ax:object)=>import('./core/path.js').Path,
 *   filled?: (t:object, ax:object)=>import('./core/path.js').Path,
 *   axes?: Record<string,{min:number,def:number,max:number,unit?:string,note?:string}>,
 *   argument?: string,
 *   family?: string,
 *   deriveFilled?: 'bold'|'solid'|'none',
 * }} def
 */
export function defineGlyph(name, def) {
  if (!def.law || def.law.length < 8) throw new Error(`глиф ${name}: закон не объявлен`);
  if (typeof def.outline !== 'function') throw new Error(`глиф ${name}: нет построителя outline`);
  if (glyphs.has(name)) throw new Error(`глиф ${name} объявлен дважды`);
  glyphs.set(name, { name, family: def.family ?? 'misc', deriveFilled: def.deriveFilled ?? 'bold', ...def });
  return def;
}

/** Значения локальных осей по умолчанию. */
export function defaultAxes(def) {
  const out = {};
  for (const [k, a] of Object.entries(def.axes ?? {})) out[k] = a.def;
  return out;
}

/** Клампинг локальной оси в объявленный диапазон. */
export function clampLocal(def, name, value) {
  const a = def.axes?.[name];
  if (!a) return value;
  return Math.min(a.max, Math.max(a.min, value));
}

/**
 * Построить вариант глифа.
 * @param {string} name
 * @param {'outline'|'filled'} variant
 * @param {object} [opt] переопределения глобальных и локальных осей
 */
export function buildGlyph(name, variant = 'outline', opt = {}) {
  const def = glyphs.get(name);
  if (!def) throw new Error(`глиф не объявлен: ${name}`);
  const ax = { ...defaultAxes(def), ...(opt.axes ?? {}) };
  for (const k of Object.keys(ax)) ax[k] = clampLocal(def, k, ax[k]);

  if (variant === 'filled') {
    const t = resolve({ ...opt, fill: 1 });
    // Filled штрихового знака = его же Bold-начертание: ось fill уже
    // переключила t.stroke.glyph, построителю ничего знать не нужно.
    return def.filled ? def.filled(t, ax) : def.outline(t, ax);
  }
  return def.outline(resolve(opt), ax);
}

export const glyphNames = () => [...glyphs.keys()].sort();
