import { describe, expect, it } from 'vitest';
import { renderObservatoryHtml } from '../scripts/build-observatory.mjs';

function fixture() {
  const row = {
    id: 'sample/outline', name: 'sample', variant: 'outline',
    original: { kind: 'CURRENT_SHIPMENT' },
    model: { status: 'NOT_MODELED', archetype: null },
    verdict: { status: 'NOT_MODELED' }, reason: { status: 'NOT_APPLICABLE' },
    metrics: null,
  };
  return {
    report: {
      policy: { deviationReasonThresholdPct: 7.5 }, rows: [row],
      summary: { glyphs: 1, variants: 1, modeled: 0, notModeled: 1,
        fail: 0, candidateFail: 0, acceptedFail: 0, review: 0, unexplained: 0 },
    },
    visuals: new Map([[row.id, { originalEntries: [], candidateEntries: null }]]),
  };
}

describe('человекочитаемое представление отчёта', () => {
  it('читает порог из того же отчёта и не меняет машинные данные', () => {
    const { report, visuals } = fixture();
    const before = structuredClone(report);
    const html = renderObservatoryHtml(report, visuals);
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain('пояснение &gt;7.5%');
    expect(html).not.toContain('&gt;3%');
    expect(html).toContain('Нет модели');
    expect(html).toContain('data-verdict="NOT_MODELED"');
    expect(report).toEqual(before);
    report.policy.deviationReasonThresholdPct = 4;
    expect(renderObservatoryHtml(report, visuals)).toContain('пояснение &gt;4%');
  });

  it('не подменяет отсутствующий или неверный порог текущим значением из кода', () => {
    for (const invalid of [undefined, NaN, Infinity, -1, '3']) {
      const { report, visuals } = fixture();
      report.policy.deviationReasonThresholdPct = invalid;
      expect(() => renderObservatoryHtml(report, visuals)).toThrow(RangeError);
    }
  });

  it('сохраняет экранирование данных при переводе подписей', () => {
    const { report, visuals } = fixture();
    report.rows[0].name = '<script>alert(1)</script>';
    const html = renderObservatoryHtml(report, visuals);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
