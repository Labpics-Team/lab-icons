/**
 * Явный карантин параметрических мастеров.
 *
 * Anatomy отвечает на вопрос «закон существует», Observatory — «закон уже
 * доказан относительно руки». Эти факты нельзя сводить к одному status:
 * generated-мастер остаётся построенным, но до закрытия quality finding
 * публичный accepted-only API обязан вернуть точный source fallback.
 */

export const MODEL_QUALITY_VERSION = 1;
export const MODEL_QUALITY_VARIANTS = Object.freeze(['outline', 'filled']);

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`model-quality: ${label} обязан быть объектом`);
  }
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0) {
    throw new TypeError(`model-quality: ${label} несёт неизвестные поля ${unknown.join(', ')}`);
  }
  if (missing.length > 0) {
    throw new TypeError(`model-quality: ${label} не имеет обязательных полей ${missing.join(', ')}`);
  }
}

function validVariantId(id) {
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/(outline|filled)$/.exec(id);
  return match ? { name: match[1], variant: match[2] } : null;
}

export function validateModelQuality(quality, anatomy = null) {
  exactKeys(quality, ['version', 'comment', 'quarantined'], 'root');
  if (quality.version !== MODEL_QUALITY_VERSION) {
    throw new RangeError(`model-quality: поддерживается version ${MODEL_QUALITY_VERSION}`);
  }
  if (typeof quality.comment !== 'string' || quality.comment.trim().length < 32) {
    throw new TypeError('model-quality: comment обязан объяснять provenance политики');
  }
  if (!quality.quarantined || typeof quality.quarantined !== 'object' || Array.isArray(quality.quarantined)) {
    throw new TypeError('model-quality: quarantined обязан быть объектом');
  }

  const ids = Object.keys(quality.quarantined);
  const sorted = [...ids].sort();
  if (JSON.stringify(ids) !== JSON.stringify(sorted)) {
    throw new Error('model-quality: quarantined обязан быть отсортирован ASCII для стабильного review');
  }
  for (const id of ids) {
    const parsed = validVariantId(id);
    if (!parsed) throw new TypeError(`model-quality: невалидный variant id ${id}`);
    const record = quality.quarantined[id];
    exactKeys(record, ['reason', 'exitCriteria'], `quarantined.${id}`);
    for (const field of ['reason', 'exitCriteria']) {
      if (typeof record[field] !== 'string' || record[field].trim().length < 24) {
        throw new TypeError(`model-quality: ${id}.${field} обязан быть содержательным`);
      }
    }
    if (anatomy) {
      const status = anatomy.glyphs?.[parsed.name]?.status?.[parsed.variant];
      if (status !== 'generated') {
        throw new Error(`model-quality: ${id} обязан ссылаться на существующий status=generated master`);
      }
    }
  }
  return quality;
}

export function quarantinedModelIds(quality, anatomy = null) {
  return new Set(Object.keys(validateModelQuality(quality, anatomy).quarantined));
}
