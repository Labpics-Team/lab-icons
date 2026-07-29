/**
 * system/glyphs/weather.js — солнце и его ось длины луча.
 *
 * sun и sun-low — НЕ две иконки. Это одна конструкция на разных значениях оси
 * `ray`: внешний терминал луча закреплён на keyline, а длина растёт внутрь от
 * нуля (терминал выродился в точку — это и есть sun-low) до предела, за
 * которым охранный зазор до диска проседает ниже минимума.
 */

import { defineGlyph } from '../registry.js';
import * as S from '../prim/shape.js';
import { rays, maxRayLen } from '../parts.js';

/** Радиус диска: замер руки — внешний 5, внутренний 3.2 = 5 − перо. */
export const SUN_DISC = 5;
/** Число лучей: 8 (кардинальные + диагонали шкалы направлений). */
export const SUN_RAYS = 8;

const RAY_MAX = (t) => maxRayLen(t, SUN_DISC, { weight: t.stroke.base });

const body = (t, len) =>
  S.ring([t.cx, t.cy], SUN_DISC, t.stroke.base).add(
    rays(t, { count: SUN_RAYS, len, weight: t.stroke.base, phase: Math.PI / 2 }),
  );

const bodyFilled = (t, len) =>
  S.circle([t.cx, t.cy], SUN_DISC).add(rays(t, { count: SUN_RAYS, len, weight: t.stroke.base, phase: Math.PI / 2 }));

const LAW =
  'диск радиуса 5 (внутренний 3.2 = 5 − перо) + 8 лучей; внешний терминал луча ' +
  'на Rkey − кап = 10.1, длина луча — ось `ray` от 0 (sun-low) до предела ' +
  'Rkey − кап − Rдиска − зазор − кап';

const AXES = (t) => ({
  ray: {
    min: 0,
    def: 1.8,
    max: 3.4,
    unit: 'ед. канвы',
    note: 'ray=0 → sun-low; ray=перо → sun; ray=max → предел негативного пространства',
  },
});

defineGlyph('sun', {
  family: 'weather',
  law: LAW,
  axes: AXES(),
  outline: (t, ax) => body(t, Math.min(ax.ray, RAY_MAX(t))),
  filled: (t, ax) => bodyFilled(t, Math.min(ax.ray, RAY_MAX(t))),
});

defineGlyph('sun-low', {
  family: 'weather',
  law: `${LAW}; sun-low = та же конструкция при ray = 0`,
  axes: { ...AXES(), ray: { ...AXES().ray, def: 0 } },
  outline: (t, ax) => body(t, Math.min(ax.ray, RAY_MAX(t))),
  filled: (t, ax) => bodyFilled(t, Math.min(ax.ray, RAY_MAX(t))),
});
