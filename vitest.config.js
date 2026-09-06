/**
 * Канонический product verification живёт только в test/** и tests/**.
 * Исторические эксперименты под epics/** запускаются собственным явным config
 * и не получают статус продуктового gate только из-за имени *.test.*.
 */
export default {
  test: {
    include: ['test/**/*.test.{js,ts}', 'tests/**/*.test.{js,ts}'],
    // Геометрические proof-тесты могут превышать стандартный локальный timeout;
    // корректность определяется assertions, а не скоростью конкретного runner.
    testTimeout: 120_000,
  },
};
