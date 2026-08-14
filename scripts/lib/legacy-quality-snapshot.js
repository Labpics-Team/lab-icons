import { createHash } from 'node:crypto';

const EXACT_ROOT_KEYS = ['comment', 'pathQuality', 'variantParity', 'version'];
const EXACT_VARIANT_KEYS = ['findingSetSha256', 'maximumFindings'];
const EXACT_PATH_KEYS = ['findingSetSha256', 'maximumFindings', 'maximumMajorFindings'];

function exactKeys(value, expected, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`legacy-quality-snapshot: ${where} обязан быть объектом`);
  }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `legacy-quality-snapshot: ${where} имеет ключи ${actual.join(', ')}, ожидались ${expected.join(', ')}`,
    );
  }
}

function natural(value, where) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`legacy-quality-snapshot: ${where} обязан быть целым >= 0`);
  }
}

function digest(value, where) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`legacy-quality-snapshot: ${where} обязан быть sha256:<64 hex>`);
  }
}

export function findingSetSha256(findings) {
  if (!Array.isArray(findings) || findings.some((finding) => typeof finding !== 'string')) {
    throw new Error('legacy-quality-snapshot: findings обязан быть массивом строк');
  }
  // Сортировка превращает отчёт в множество с учётом кратности: порядок обхода
  // файлов не меняет proof, а замена старого долга новым при том же count меняет hash.
  const canonical = JSON.stringify(findings.slice().sort());
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function validateLegacyQualitySnapshot(value) {
  exactKeys(value, EXACT_ROOT_KEYS, 'root');
  if (value.version !== 1) throw new Error('legacy-quality-snapshot: поддерживается только version=1');
  if (typeof value.comment !== 'string' || value.comment.length < 20) {
    throw new Error('legacy-quality-snapshot: comment обязан фиксировать происхождение долга');
  }
  exactKeys(value.variantParity, EXACT_VARIANT_KEYS, 'variantParity');
  exactKeys(value.pathQuality, EXACT_PATH_KEYS, 'pathQuality');
  natural(value.variantParity.maximumFindings, 'variantParity.maximumFindings');
  natural(value.pathQuality.maximumFindings, 'pathQuality.maximumFindings');
  natural(value.pathQuality.maximumMajorFindings, 'pathQuality.maximumMajorFindings');
  if (value.pathQuality.maximumMajorFindings > value.pathQuality.maximumFindings) {
    throw new Error('legacy-quality-snapshot: maximumMajorFindings не может превышать maximumFindings');
  }
  digest(value.variantParity.findingSetSha256, 'variantParity.findingSetSha256');
  digest(value.pathQuality.findingSetSha256, 'pathQuality.findingSetSha256');
  return value;
}

export function compareDebtSnapshot(findings, snapshot, { major = null } = {}) {
  const errors = [];
  const actualDigest = findingSetSha256(findings);
  if (findings.length > snapshot.maximumFindings) {
    errors.push(`findings ${findings.length} > ceiling ${snapshot.maximumFindings}`);
  }
  if (actualDigest !== snapshot.findingSetSha256) {
    errors.push(`finding-set ${actualDigest} != frozen ${snapshot.findingSetSha256}`);
  }
  if (major) {
    const majorCount = findings.filter(major).length;
    if (majorCount > snapshot.maximumMajorFindings) {
      errors.push(`major ${majorCount} > ceiling ${snapshot.maximumMajorFindings}`);
    }
  }
  return errors;
}
