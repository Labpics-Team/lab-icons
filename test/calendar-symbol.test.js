import { describe, expect, it } from 'vitest';
import calendar from '../dist/symbols/calendar-number.js';
import family from '../dist/states/calendar.js';
import time from '../dist/symbols/time.js';
import { renderIcon } from '../src/render/index.ts';
import { resolveIconRequest } from '../src/render/request.ts';
import { sampleOpticalScalar, sampleOpticalPath, opticalPathData } from '../src/render/optical-grid.ts';
import { pathBBox } from '../src/core/path-data.js';

const input = day => ({ date: new Date(Date.UTC(2026, 0, day, 12)), timeZone: 'UTC' });

describe('calendar content on the shared symbol API', () => {
  it('centers the tabular glyphs in the accepted lower window as either axis changes', () => {
    const shell = calendar.data.variants.outline.paths[calendar.semantics.calendar.shells.outline[0].pathIndex];
    const zero = calendar.semantics.calendar.digits[0];
    for (const weight of [300, 350, 400, 500, 600]) for (const opsz of [16, 20, 24, 36, 48]) {
      const { position } = resolveIconRequest(calendar, { ...input(8), weight, opsz });
      const window = pathBBox(opticalPathData(shell, sampleOpticalPath(shell, position), [1]));
      const digit = pathBBox(opticalPathData(zero, sampleOpticalPath(zero, position)));
      const radius = sampleOpticalScalar(zero.stroke.width, position) / 2;
      expect((digit.minY + digit.maxY) / 2).toBeCloseTo((window.minY + window.maxY) / 2, 7);
      expect(digit.minY - radius).toBeGreaterThan(window.minY);
      expect(digit.maxY + radius).toBeLessThan(window.maxY);
    }
  });
  it('selects ten shared numeric glyphs without building per-day outlines', () => {
    expect(calendar.semantics.calendar.digits).toHaveLength(10);
    for (let day = 1; day <= 31; day++) {
      const request = resolveIconRequest(calendar, input(day));
      const paths = request.data.variants.outline.paths;
      const digits = request.parts.filter(part => part.offsetX);
      expect(digits).toHaveLength(day < 10 ? 1 : 2);
      for (const part of digits) {
        expect(calendar.semantics.calendar.digits).toContain(paths[part.pathIndex]);
        expect(paths[part.pathIndex].stroke).toBeDefined();
      }
      if (day < 10) expect(sampleOpticalScalar(digits[0].offsetX, request.position)).toBe(0);
      else expect(sampleOpticalScalar(digits[0].offsetX, request.position))
        .toBe(-sampleOpticalScalar(digits[1].offsetX, request.position));
    }
  });

  it('resolves Date as an instant in the explicitly named IANA zone', () => {
    const date = new Date('2026-01-01T00:30:00Z');
    expect(renderIcon(calendar, { date, timeZone: 'UTC' })).toBe(renderIcon(calendar, input(1)));
    expect(renderIcon(calendar, { date, timeZone: 'America/Los_Angeles' })).toBe(renderIcon(calendar, input(31)));
    expect(renderIcon(calendar, { date: new Date('2026-01-01T23:30:00Z'), timeZone: 'Asia/Tokyo' }))
      .toBe(renderIcon(calendar, input(2)));
    for (const instant of ['2026-03-08T09:30:00Z', '2026-03-08T10:30:00Z']) {
      expect(renderIcon(calendar, { date: new Date(instant), timeZone: 'America/Los_Angeles' })).toBe(renderIcon(calendar, input(8)));
    }
    expect(renderIcon(calendar, { date: new Date('2024-02-29T12:00:00Z'), timeZone: 'UTC' })).toBe(renderIcon(calendar, input(29)));
  });

  it('retains the author source without a requested date and carries the date through the family', () => {
    expect(renderIcon(calendar)).toBe(calendar.outline);
    expect(renderIcon(family, { ...input(29), state: 'date' })).toBe(renderIcon(calendar, input(29)));
    expect(renderIcon(family, { ...input(29), state: 'clear' })).toBe(renderIcon(family, { state: 'clear' }));
  });

  it.each([
    { date: new Date(0) }, { timeZone: 'UTC' }, { ...input(1), date: new Date(NaN) },
    { ...input(1), timeZone: '+01:00' }, { ...input(1), timeZone: 'Mars/Crater' },
    { ...input(1), timeZone: ' UTC ' },
  ])('rejects incomplete or invalid explicit date input %#', options => {
    expect(() => renderIcon(calendar, options)).toThrow();
    expect(() => renderIcon(family, { ...options, state: 'clear' })).toThrow();
  });

  it('does not add date content to another symbol or read implicit clocks', () => {
    expect(() => renderIcon(time, input(1))).toThrow('does not support');
    const original = Date.now;
    Date.now = () => { throw new Error('implicit clock'); };
    try { expect(renderIcon(calendar, input(1))).toBe(renderIcon(calendar, input(1))); }
    finally { Date.now = original; }
  });
});
