/**
 * Контракт геометрической даты: время приходит снаружи, цифры строятся без
 * шрифта, а opsz меняет мастер, не ломая его топологию.
 */

import { describe, expect, it } from 'vitest';
import { parsePathData } from '../scripts/lib/path-data.js';
import {
  CALENDAR_APERTURE_RATIO,
  CALENDAR_CANVAS_SIZE,
  CALENDAR_OPSZ_RANGE,
  DEFAULT_CALENDAR_APERTURE,
  buildCalendarNumberGeometry,
  resolveCalendarDay,
  roundedDigitGeometry,
} from '../scripts/lib/calendar-geometry.js';

function commandSignature(d) {
  return parsePathData(d).map(({ cmd }) => cmd).join('');
}

function calendarConstraint(result, measurementMethod) {
  const matches = result.negativeSpace.constraints.filter((constraint) => (
    constraint.measurementMethod === measurementMethod
  ));
  expect(matches, measurementMethod).toHaveLength(1);
  return matches[0];
}

describe('resolveCalendarDay — время и зона являются явным входом', () => {
  it('разрешает один instant в разные календарные дни', () => {
    const date = new Date('2026-01-01T00:30:00.000Z');
    expect(resolveCalendarDay({ date, timeZone: 'UTC' })).toEqual({
      day: 1,
      epochMilliseconds: date.getTime(),
      timeZone: 'UTC',
    });
    expect(resolveCalendarDay({ date, timeZone: 'America/Los_Angeles' }).day).toBe(31);
  });

  it('принимает валидную IANA fixed-offset zone, отсутствующую в supportedValuesOf', () => {
    const date = new Date('2026-07-16T22:30:00.000Z');
    expect(resolveCalendarDay({ date, timeZone: 'Etc/GMT-3' })).toEqual({
      day: 17,
      epochMilliseconds: date.getTime(),
      timeZone: 'Etc/GMT-3',
    });
  });

  it('не читает Date.now и детерминирован для одного входа', () => {
    const originalNow = Date.now;
    Date.now = () => {
      throw new Error('скрытое текущее время запрещено');
    };
    try {
      const input = { date: new Date('2024-02-29T23:59:59.999Z'), timeZone: 'UTC' };
      expect(resolveCalendarDay(input)).toEqual(resolveCalendarDay(input));
      expect(resolveCalendarDay(input).day).toBe(29);
    } finally {
      Date.now = originalNow;
    }
  });

  it.each([
    [{}, 'date'],
    [{ date: '2026-07-16T00:00:00Z', timeZone: 'UTC' }, 'Date'],
    [{ date: new Date(Number.NaN), timeZone: 'UTC' }, 'date'],
    [{ date: new Date(0), timeZone: '' }, 'timeZone'],
    [{ date: new Date(0), timeZone: ' UTC ' }, 'timeZone'],
    [{ date: new Date(0), timeZone: 'Mars/Olympus_Mons' }, 'timeZone'],
    [{ date: new Date(0), timeZone: '+01:00' }, 'timeZone'],
  ])('fail-closed для hostile-входа %#', (input, fragment) => {
    expect(() => resolveCalendarDay(input)).toThrow(fragment);
  });
});

describe('roundedDigitGeometry — собственный tabular rounded master', () => {
  it('выводит 24-unit aperture из одного нормализованного ratio-token', () => {
    expect(CALENDAR_CANVAS_SIZE).toBe(24);
    expect(Object.fromEntries(Object.entries(CALENDAR_APERTURE_RATIO)
      .map(([name, value]) => [name, value * CALENDAR_CANVAS_SIZE])))
      .toEqual(DEFAULT_CALENDAR_APERTURE);
  });

  it('строит все цифры 0–9 из line/cubic деклараций без font/DOM', () => {
    const advances = [];
    for (let digit = 0; digit <= 9; digit++) {
      const geometry = roundedDigitGeometry(digit, { opsz: 24 });
      advances.push(geometry.advanceWidth);
      expect(geometry.digit).toBe(digit);
      expect(geometry.d).toMatch(/^M/);
      expect(geometry.primitives.length).toBeGreaterThan(1);
      expect(geometry.primitives.every(({ kind }) => kind === 'move' || kind === 'line' || kind === 'cubic' || kind === 'close')).toBe(true);
      expect(commandSignature(geometry.d)).toBe(geometry.topologySignature);
      expect(geometry.paint).toMatchObject({ fill: 'none', linecap: 'round', linejoin: 'round' });
      expect(geometry.d.toLowerCase()).not.toContain('nan');
    }
    expect(new Set(advances).size).toBe(1);
  });

  it('opsz 16..48 меняет и толщину, и скелет, сохраняя команды каждого мастера', () => {
    expect(CALENDAR_OPSZ_RANGE).toEqual({ min: 16, default: 24, max: 48 });
    for (let digit = 0; digit <= 9; digit++) {
      const small = roundedDigitGeometry(digit, { opsz: 16 });
      const regular = roundedDigitGeometry(digit, { opsz: 24 });
      const display = roundedDigitGeometry(digit, { opsz: 48 });
      expect(small.paint.strokeWidth).toBeGreaterThan(display.paint.strokeWidth);
      expect(small.d).not.toBe(display.d);
      expect(small.topologySignature).toBe(regular.topologySignature);
      expect(regular.topologySignature).toBe(display.topologySignature);
      expect(commandSignature(small.d)).toBe(commandSignature(display.d));
    }
  });

  it.each([-1, 1.5, 10, Number.NaN, '3'])('отклоняет нецифру %s', (digit) => {
    expect(() => roundedDigitGeometry(digit, { opsz: 24 })).toThrow('digit');
  });

  it.each([15.999, 48.001, Number.NaN, '24'])('не clamp-ит невалидный opsz %s', (opsz) => {
    expect(() => roundedDigitGeometry(3, { opsz })).toThrow('opsz');
  });

  it('не превращает явный null в default', () => {
    expect(() => roundedDigitGeometry(3, { opsz: null })).toThrow('opsz');
    expect(() => roundedDigitGeometry(3, null)).toThrow('options');
  });

  it('закрывает options и cell вместо молчаливого no-op', () => {
    expect(() => roundedDigitGeometry(3, { opzs: 24 })).toThrow('неизвестный параметр');
    expect(() => roundedDigitGeometry(3, {
      cell: { centerX: 12, centerY: 12, width: 4, height: 8, magic: 1 },
    })).toThrow('неизвестный параметр');
    expect(() => roundedDigitGeometry(3, {
      cell: { centerX: 23, centerY: 12, width: 4, height: 8 },
    })).toThrow('внутри');
    expect(() => roundedDigitGeometry(3, {
      cell: { centerX: 12, centerY: 12, width: 1e-10, height: 1e-10 },
    })).toThrow('меньше 2px');
  });
});

describe('buildCalendarNumberGeometry — 1..31 внутри aperture', () => {
  it('публикует normalized constraints без представимого fail verdict', () => {
    const result = buildCalendarNumberGeometry({
      date: new Date('2026-07-24T12:00:00Z'),
      timeZone: 'UTC',
      opsz: 16,
    });
    expect(Object.isFrozen(result.negativeSpace)).toBe(true);
    expect(Object.isFrozen(result.negativeSpace.constraints)).toBe(true);
    expect(result.negativeSpace.constraints.map(({ measurementMethod }) => measurementMethod))
      .toEqual(['ink-bounds-to-canvas', 'horizontal-ink-bounds-separation']);
    for (const constraint of result.negativeSpace.constraints) {
      expect(constraint.unit).toBe('normalized-canvas');
      expect(constraint.measured + 1e-9).toBeGreaterThanOrEqual(constraint.requiredMinimum);
      expect(constraint.participants.length).toBeGreaterThanOrEqual(2);
      expect(Object.isFrozen(constraint.participants)).toBe(true);
      expect(constraint).not.toHaveProperty('pass');
      expect(constraint).not.toHaveProperty('status');
    }
  });

  it('geometry-backed digit gap меняется вместе с цифрами', () => {
    const gap = (day) => calendarConstraint(buildCalendarNumberGeometry({
      date: new Date(Date.UTC(2026, 0, day, 12)),
      timeZone: 'UTC',
      opsz: 24,
    }), 'horizontal-ink-bounds-separation').measured;
    expect(new Set([gap(10), gap(11), gap(24), gap(31)]).size).toBeGreaterThan(1);
  });

  it('отвергает aperture, чьи построенные чернила не сохраняют exterior minimum', () => {
    expect(() => buildCalendarNumberGeometry({
      date: new Date('2026-07-01T12:00:00Z'),
      timeZone: 'UTC',
      opsz: 24,
      aperture: { x: 0, y: 0, width: 11.5, height: 8.25 },
    })).toThrow(/negative-space measured .* requiredMinimum/);
  });

  it('создаёт стабильные semantic part id и удаляет десяток только естественно', () => {
    const one = buildCalendarNumberGeometry({
      date: new Date('2026-07-01T12:00:00Z'),
      timeZone: 'UTC',
      opsz: 24,
    });
    expect(one.day).toBe(1);
    expect(one.parts.map(({ id }) => id)).toEqual(['calendar.date.ones']);

    const thirtyOne = buildCalendarNumberGeometry({
      date: new Date('2026-07-31T12:00:00Z'),
      timeZone: 'UTC',
      opsz: 24,
    });
    expect(thirtyOne.parts.map(({ id }) => id)).toEqual([
      'calendar.date.tens',
      'calendar.date.ones',
    ]);
    expect(thirtyOne.parts.map(({ digit }) => digit)).toEqual([3, 1]);
  });

  it('property-ish: каждый день центрирован, в aperture и tabular', () => {
    const aperture = DEFAULT_CALENDAR_APERTURE;
    const apertureCenter = aperture.x + aperture.width / 2;
    for (let day = 1; day <= 31; day++) {
      const date = new Date(Date.UTC(2026, 0, day, 12));
      for (const opsz of [16, 17, 23.5, 24, 31, 47.75, 48]) {
        const result = buildCalendarNumberGeometry({ date, timeZone: 'UTC', opsz });
        expect(result.day).toBe(day);
        expect(result.layout.center.x).toBeCloseTo(apertureCenter, 12);
        expect(result.layout.center.y).toBeCloseTo(aperture.y + aperture.height / 2, 12);
        expect(result.layout.inkBounds.minX).toBeGreaterThanOrEqual(aperture.x - 1e-9);
        expect(result.layout.inkBounds.maxX).toBeLessThanOrEqual(aperture.x + aperture.width + 1e-9);
        expect(result.layout.inkBounds.minY).toBeGreaterThanOrEqual(aperture.y - 1e-9);
        expect(result.layout.inkBounds.maxY).toBeLessThanOrEqual(aperture.y + aperture.height + 1e-9);
        expect(new Set(result.parts.map(({ advanceWidth }) => advanceWidth)).size).toBe(1);
        for (const constraint of result.negativeSpace.constraints) {
          expect(constraint.measured + 1e-9, `${day}/${opsz}/${constraint.measurementMethod}`)
            .toBeGreaterThanOrEqual(constraint.requiredMinimum);
        }
      }
    }
  });

  it('не допускает мутировать результат между вызовами', () => {
    const input = { date: new Date('2026-07-16T12:00:00Z'), timeZone: 'UTC', opsz: 24 };
    const first = buildCalendarNumberGeometry(input);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.parts)).toBe(true);
    expect(() => { first.parts[0].digit = 9; }).toThrow();
    expect(buildCalendarNumberGeometry(input)).toEqual(first);
  });

  it('fail-closed для невалидного aperture', () => {
    const common = { date: new Date(0), timeZone: 'UTC', opsz: 24 };
    expect(() => buildCalendarNumberGeometry({ ...common, aperture: { x: 0, y: 0, width: 0, height: 8 } })).toThrow('aperture.width');
    expect(() => buildCalendarNumberGeometry({ ...common, aperture: { x: 0, y: 0, width: 10, height: Infinity } })).toThrow('aperture.height');
    expect(() => buildCalendarNumberGeometry({ ...common, aperture: { x: 20, y: 0, width: 10, height: 8 } })).toThrow('внутри');
    expect(() => buildCalendarNumberGeometry({ ...common, aperture: { x: 0, y: 0, width: 10, height: 8, magic: 1 } })).toThrow('неизвестный параметр');
    expect(() => buildCalendarNumberGeometry({ ...common, opzs: 24 })).toThrow('неизвестный параметр');
    expect(() => buildCalendarNumberGeometry({ ...common, opsz: null })).toThrow('opsz');
    expect(() => buildCalendarNumberGeometry({ ...common, aperture: null })).toThrow('aperture');
  });
});
