import { describe, expect, it } from 'vitest';
// @ts-expect-error — внутренний JS geometry oracle типизируется по фактическому результату.
import { pathBBox } from '../scripts/lib/path-data.js';
// @ts-expect-error — внутренний deterministic raster oracle типизируется по факту.
import { compareSilhouettes } from '../scripts/lib/quality-metrics.js';
// @ts-expect-error — policy SSOT принадлежит build-time quality layer.
import { AUTO_ACCEPTANCE_DEVIATION_PCT } from '../scripts/lib/quality-policy.js';
import {
  axisContracts,
  axisNames,
  glyph,
  glyphCapabilities,
  iconIds,
  isIconId,
  parseGlyphRequest,
  calendarNumberGlyph,
  type AxisName,
  type FillRule,
  type GlyphIR,
  type IconVariant,
} from '../src/ir/index.js';

function silhouetteEntries(value: GlyphIR): Array<{ d: string; fillRule: FillRule }> {
  if (value.composition.kind === 'compound') {
    return [{ d: value.d, fillRule: value.composition.fillRule }];
  }
  if (value.composition.kind === 'layers') {
    return value.parts.map((part) => ({ d: part.d, fillRule: part.fillRule ?? 'nonzero' }));
  }
  throw new Error('test oracle: mask-subtract не относится к catalog model');
}

describe('public Glyph IR', () => {
  it('парсит недоверенный запрос один раз и отвергает неизвестные состояния', () => {
    expect(isIconId('reload')).toBe(true);
    expect(isIconId('not-an-icon')).toBe(false);
    expect(parseGlyphRequest({ icon: 'reload' })).toEqual({
      icon: 'reload',
      variant: 'outline',
      modelMode: 'accepted-only',
      axes: {},
    });

    expect(() => parseGlyphRequest({ icon: 'not-an-icon' })).toThrow(/неизвестная иконка/);
    expect(() => parseGlyphRequest({ icon: 'reload', variant: 'solid' })).toThrow(/variant/);
    expect(() => parseGlyphRequest({ icon: 'reload', modelMode: 'maybe' })).toThrow(/modelMode/);
    expect(() => parseGlyphRequest({ icon: 'reload', typo: true })).toThrow(/неизвестные поля/);
  });

  it('не пропускает candidate через accepted-only', () => {
    expect(glyphCapabilities('reload', 'outline')).toMatchObject({
      modelState: 'candidate',
      supportedAxes: [],
    });

    const guarded = glyph({ icon: 'reload', variant: 'outline' });
    expect(guarded.provenance.kind).toBe('source');

    const explicit = glyph({
      icon: 'reload',
      variant: 'outline',
      modelMode: 'allow-candidate',
    });
    expect(explicit.provenance).toMatchObject({
      kind: 'model',
      state: 'candidate',
    });

    // reload/filled построен (anatomy=generated), но Observatory держит его
    // крупную коррекцию в quarantine: это отдельная ветка от hand-candidate.
    expect(glyphCapabilities('reload', 'filled').modelState).toBe('candidate');
    expect(glyph({ icon: 'reload', variant: 'filled' }).provenance.kind).toBe('source');
    expect(glyph({
      icon: 'reload',
      variant: 'filled',
      modelMode: 'allow-candidate',
    }).provenance).toMatchObject({ kind: 'model', state: 'candidate' });
  });

  it('падает на неизвестной, не поддержанной, нечисловой и потерянной оси', () => {
    expect(Object.isFrozen(iconIds)).toBe(true);
    expect(Object.isFrozen(axisNames)).toBe(true);
    expect(axisNames).toEqual(['corner', 'opsz', 'weight']);
    expect(axisContracts.opsz).toEqual({
      kind: 'continuous',
      min: 16,
      default: 24,
      max: 48,
      lifecycle: 'active-in-recipe-kernels',
    });
    expect(axisContracts.weight.lifecycle).toBe('active-after-sampled-optical-proof');
    expect(glyphCapabilities('chevron-up', 'filled').axes).toEqual({
      weight: axisContracts.weight,
    });
    expect(glyphCapabilities('reload', 'filled').axes).toEqual({});
    expect(() => glyph({
      icon: 'reload',
      variant: 'filled',
      modelMode: 'allow-candidate',
      axes: { weight: 1 },
    })).toThrow(/не поддерживает ось weight/);
    expect(() => glyph({
      icon: 'chevron-up',
      variant: 'filled',
      axes: { weight: Number.NaN },
    })).toThrow(/конечным числом/);
    expect(() => glyph({
      icon: 'chevron-up',
      variant: 'filled',
      axes: { weight: 999 },
    })).toThrow(/вне диапазона/);
    expect(() => parseGlyphRequest({
      icon: 'reload',
      axes: { fantasy: 1 },
    })).toThrow(/неизвестная ось/);
    expect(() => glyph({
      icon: 'chevron-up',
      variant: 'outline',
      modelMode: 'source-only',
      axes: { weight: 1 },
    })).toThrow(/не имеет разрешённой модели/);
  });

  it('даёт точный source fallback для всех 222 × 2 вариантов без DOM и IO', () => {
    expect(iconIds).toHaveLength(222);
    const variants: readonly IconVariant[] = ['outline', 'filled'];

    for (const icon of iconIds) {
      for (const variant of variants) {
        const result = glyph({ icon, variant, modelMode: 'source-only' });
        expect(result.provenance.kind, `${icon}/${variant}`).toBe('source');
        expect(result.parts.length, `${icon}/${variant}`).toBeGreaterThan(0);
        expect(result.d, `${icon}/${variant}`).toBe(
          result.parts.map((part) => part.d).join(''),
        );
        expect(result.svg, `${icon}/${variant}`).toContain('fill="currentColor"');
        expect(result.svg, `${icon}/${variant}`).toContain('data-part=');
        for (const part of result.parts) {
          expect(Number.isFinite(part.anchor[0]), `${icon}/${variant}/${part.id}`).toBe(true);
          expect(Number.isFinite(part.anchor[1]), `${icon}/${variant}/${part.id}`).toBe(true);
        }
      }
    }
  });

  it('сохраняет identity и topology доказанного chevron на всей оси веса', () => {
    const samples = [0.6, 1, 1.29167].map((weight) => glyph({
      icon: 'chevron-up',
      variant: 'outline',
      axes: { weight },
    }));

    expect(samples[0]?.parts.map((part) => part.id)).toEqual(['mark']);
    expect(new Set(samples.map((sample) =>
      sample.parts.map((part) => `${part.id}:${part.topologySignature}`).join('|'),
    )).size).toBe(1);
    expect(new Set(samples.map((sample) => sample.d)).size).toBe(3);
    for (const sample of samples) {
      expect(sample.parts.every((part) => part.provenance.kind === 'model')).toBe(true);
    }
  });

  it('не приписывает compound-частям ложный самостоятельный fill rule', () => {
    const cog = glyph({ icon: 'cog', variant: 'outline', modelMode: 'allow-candidate' });
    expect(cog.composition).toEqual({ kind: 'compound', fillRule: 'evenodd' });
    expect(cog.parts.every((part) => part.fillRule === null)).toBe(true);
    expect(cog.svg).toContain('fill-rule="evenodd"');
  });

  it('строит каждую объявленную модель на границах осей со стабильными part.id', () => {
    const variants: readonly IconVariant[] = ['outline', 'filled'];
    const limits: Readonly<Record<AxisName, readonly [number, number]>> = {
      corner: [0, 1.666667],
      opsz: [16, 48],
      weight: [0.6, 1.29167],
    };

    for (const icon of iconIds) {
      for (const variant of variants) {
        const capabilities = glyphCapabilities(icon, variant);
        if (!capabilities.modelState) continue;
        const modelMode = capabilities.modelState === 'candidate'
          ? 'allow-candidate'
          : 'accepted-only';
        const baseline = glyph({ icon, variant, modelMode });
        expect(baseline.provenance.kind, `${icon}/${variant}`).toBe('model');
        const identity = baseline.parts.map((part) => part.id);

        for (const axis of capabilities.supportedAxes) {
          for (const value of limits[axis]) {
            const sample = glyph({
              icon,
              variant,
              modelMode,
              axes: { [axis]: value },
            });
            expect(
              sample.parts.map((part) => part.id),
              `${icon}/${variant}/${axis}=${value}`,
            ).toEqual(identity);
            expect(sample.parts.every((part) => part.topologySignature.length > 0)).toBe(true);
            for (const part of sample.parts) {
              if (part.anchorSource !== 'geometry-bbox-center') continue;
              const bounds = pathBBox(part.d);
              expect(part.anchor[0], `${icon}/${variant}/${axis}=${value}/${part.id}/x`)
                .toBeCloseTo((bounds.minX + bounds.maxX) / 48, 10);
              expect(part.anchor[1], `${icon}/${variant}/${axis}=${value}/${part.id}/y`)
                .toBeCloseTo((bounds.minY + bounds.maxY) / 48, 10);
            }
          }
        }
      }
    }
  });

  it('accepted default master не выходит за общий auto-acceptance предел от shipment source', () => {
    const variants: readonly IconVariant[] = ['outline', 'filled'];
    let accepted = 0;
    let worst = { id: '', deviationPct: -Infinity };
    const topologyIssues: string[] = [];
    for (const icon of iconIds) {
      for (const variant of variants) {
        if (glyphCapabilities(icon, variant).modelState !== 'accepted') continue;
        accepted++;
        const source = glyph({ icon, variant, modelMode: 'source-only' });
        const model = glyph({ icon, variant, modelMode: 'accepted-only' });
        const comparison = compareSilhouettes(
          silhouetteEntries(source),
          silhouetteEntries(model),
        );
        if (comparison.deviationPct > worst.deviationPct) {
          worst = { id: `${icon}/${variant}`, deviationPct: comparison.deviationPct };
        }
        if (comparison.topology.difference || comparison.topology.uncertain) {
          topologyIssues.push(`${icon}/${variant}`);
        }
      }
    }
    expect(accepted).toBe(54);
    expect(topologyIssues).toEqual([]);
    expect(worst.deviationPct, worst.id).toBeLessThanOrEqual(AUTO_ACCEPTANCE_DEVIATION_PCT);
  });

  it('calendar-number меняет день из явного context, сохраняя shell и slots', () => {
    const first = calendarNumberGlyph({
      date: new Date('2026-07-01T12:00:00.000Z'),
      timeZone: 'UTC',
      opsz: 24,
    });
    const second = calendarNumberGlyph({
      date: new Date('2026-07-12T12:00:00.000Z'),
      timeZone: 'UTC',
      opsz: 24,
    });
    expect(first.parts.map((part) => part.id)).toEqual(['calendar.shell', 'calendar.date.ones']);
    expect(second.parts.map((part) => part.id)).toEqual([
      'calendar.shell',
      'calendar.date.tens',
      'calendar.date.ones',
    ]);
    expect(first.parts.map((part) => part.zIndex)).toEqual([0, 2]);
    expect(second.parts.map((part) => part.zIndex)).toEqual([0, 1, 2]);
    expect(first.parts[0]?.d).toBe(second.parts[0]?.d);
    expect(first.parts.at(-1)?.d).not.toBe(second.parts.at(-1)?.d);
    expect(second.svg).toContain('stroke="currentColor"');
    expect(second.parts.slice(1).every((part) => part.morphGroup === null)).toBe(true);
    expect(second.provenance).toMatchObject({
      kind: 'recipe',
      context: { day: 12, timeZone: 'UTC' },
    });

    const filled = calendarNumberGlyph({
      date: new Date('2026-07-12T12:00:00.000Z'),
      timeZone: 'UTC',
      variant: 'filled',
    });
    expect(filled.composition).toEqual({
      kind: 'mask-subtract',
      basePartIds: ['calendar.shell'],
      subtractPartIds: ['calendar.date.tens', 'calendar.date.ones'],
    });
    expect(filled.svg).toContain('<mask');
    expect(filled.svg).toContain('stroke="#000"');
    expect(filled.svg).not.toMatch(/<g mask="[^"]+">[\s\S]*stroke="currentColor"/);
  });

  it('calendar mask id content-addressed и не сталкивается на известной 32-bit паре', () => {
    const request = {
      date: new Date('2026-07-16T12:00:00.000Z'),
      timeZone: 'UTC',
      variant: 'filled' as const,
    };
    const first = calendarNumberGlyph({ ...request, opsz: 18.890666666666668 });
    const second = calendarNumberGlyph({ ...request, opsz: 25.261511111111112 });
    const maskId = (svg: string) => svg.match(/<mask id="([^"]+)"/)?.[1];

    expect(first.parts.map((part) => part.d)).not.toEqual(second.parts.map((part) => part.d));
    expect(maskId(first.svg)).toMatch(/^lab-icons-mask-[a-f0-9]{64}$/);
    expect(maskId(second.svg)).toMatch(/^lab-icons-mask-[a-f0-9]{64}$/);
    expect(maskId(first.svg)).not.toBe(maskId(second.svg));
  });
});
