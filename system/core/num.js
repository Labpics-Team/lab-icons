/**
 * system/core/num.js — числовая гигиена.
 *
 * Одна политика округления на всю систему. Дробные координаты законны ровно
 * там, где они СЛЕДСТВИЕ (точка на дуге, пересечение), и незаконны там, где
 * они каприз: опорные точки конструкции обязаны выводиться из токенов.
 */

/** Геометрический эпсилон в единицах канвы 24 (≈1/2000 канвы). */
export const EPS = 1e-3;
/** Эпсилон сравнения параметров кривой (безразмерный). */
export const TEPS = 1e-9;

/** Разрядность вывода координат. Корпус руки живёт на 2–3 знаках. */
export const OUT_DP = 3;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rad = (deg) => (deg * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

/** Нормализация угла в [0, 2π). */
export function norm2pi(a) {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/**
 * Компактная запись числа для d-атрибута: 3 знака, без хвостовых нулей,
 * без ведущего нуля («.9», не «0.9») — как в корпусе руки.
 */
export function fmt(v) {
  let n = Number(v.toFixed(OUT_DP));
  if (Object.is(n, -0)) n = 0;
  let s = String(n);
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
}

/** Пара координат для d-атрибута. */
export const fmtP = (p) => `${fmt(p[0])} ${fmt(p[1])}`;

/** Округление до сетки вывода — чтобы сравнения шли по тем же числам, что в d. */
export const q = (v) => Number(v.toFixed(OUT_DP));

export const v2 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  /** a + b·k — самая частая форма в конструкциях. */
  mad: (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k],
  len: (a) => Math.hypot(a[0], a[1]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  cross: (a, b) => a[0] * b[1] - a[1] * b[0],
  norm: (a) => {
    const l = Math.hypot(a[0], a[1]);
    return l < TEPS ? [0, 0] : [a[0] / l, a[1] / l];
  },
  /** Левая нормаль (поворот на −90° в экранных координатах: y вниз). */
  lnorm: (a) => [a[1], -a[0]],
  /** Правая нормаль. */
  rnorm: (a) => [-a[1], a[0]],
  rot: (a, ang) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
  },
  eq: (a, b, eps = EPS) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps,
  /** Точка на окружности. */
  polar: (c, r, ang) => [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)],
};

/**
 * Снап угла к шкале направлений: если наклон отстоит от шкалы меньше чем на
 * `tolDeg`, это экспортный дребезг, а не намеренная диагональ.
 */
export function snapAngle(angleDeg, scale, tolDeg) {
  const a = ((angleDeg % 180) + 180) % 180;
  for (const s of scale) {
    const d = Math.abs(a - s);
    if (d > 0 && d <= tolDeg) return angleDeg + Math.sign(s - a) * d;
  }
  return angleDeg;
}
