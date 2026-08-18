/** Shared acceptance policy for catalog, Observatory and differential gates. */
// SSOT порога — semantics/quality-thresholds.json (r2 DOC-01); здесь только реэкспорт.
import thresholds from '../../semantics/quality-thresholds.json' with { type: 'json' };

export const AUTO_ACCEPTANCE_DEVIATION_PCT = thresholds.acceptance.autoDeviationPct;
