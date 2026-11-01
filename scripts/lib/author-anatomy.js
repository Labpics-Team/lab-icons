import { createHash } from 'node:crypto';
import { validateMotionGesture } from '../../src/core/motion-sampler.js';

const NAME = /^[a-z][a-z0-9-]*$/;
const HASH = /^[a-f0-9]{64}$/;
const VARIANTS = ['outline', 'filled'];
const stableJSON = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item);

export class AuthorAnatomyError extends Error {
  constructor(code, message) {
    super(`author-anatomy: ${message}`);
    this.name = 'AuthorAnatomyError';
    this.code = code;
  }
}

function refuse(code, message) {
  throw new AuthorAnatomyError(code, message);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function fields(value, expected, label) {
  if (!record(value) || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    refuse('ANNOTATION_INVALID', `${label}: требуются только поля ${expected.join(', ')}`);
  }
}

function freezeTree(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Один закон двух циклических команд. Он не разделяет соединённые контуры
 * на предполагаемые части: независимые стрелки часов требуют другой анатомии.
 */
function clockwiseCycle(icon, variant, declaration, parts) {
  fields(declaration, ['law', 'partId'], `${icon}/${variant}.gesture`);
  if (declaration.law !== 'cycle.clockwise') {
    refuse('LAW_UNSUPPORTED', `${icon}/${variant}: закон ${declaration.law} не объявлен`);
  }
  const part = parts.find(item => item.id === declaration.partId);
  if (!part || parts.length !== 1 || part.role !== 'control' ||
      part.topologySignature.includes('|') || !part.topologySignature.endsWith('Z')) {
    refuse('LAW_TOPOLOGY_UNSUPPORTED', `${icon}/${variant}: cycle.clockwise требует одну целую замкнутую управляющую часть`);
  }
  const gesture = {
    id: `${icon}.cycle`,
    kind: 'cycle',
    meaning: 'Один оборот команды обновления по часовой стрелке; промежуточную позу можно развернуть или продолжить.',
    partIds: [part.id],
    progress: 'normalized-0-to-1',
    tracks: [{ partId: part.id, kind: 'rotate', anchor: [...part.anchor],
      from: 0, to: 360, unit: 'degrees', interpolation: 'linear' }],
  };
  validateMotionGesture(gesture);
  return [gesture];
}

/**
 * Смысл задаётся явно, а geometry остаётся у проверенного master. Индексы
 * адресуют только этот закреплённый экспорт; наружу выходят стабильные part.id.
 * Весь документ проверяется до выдачи проекции, без частичного admission.
 */
export function compileAuthorAnatomy(baseline, document) {
  fields(document, ['schemaVersion', 'source', 'icons'], 'document');
  fields(document.source, ['fileKey', 'version'], 'source');
  if (document.schemaVersion !== 1 || !record(document.icons)) {
    refuse('ANNOTATION_INVALID', 'требуется versioned документ анатомии');
  }
  if (!baseline?.source || document.source.fileKey !== baseline.source.fileKey ||
      document.source.version !== baseline.source.version) {
    refuse('SOURCE_MISMATCH', 'анатомия относится к другому файлу или версии Figma');
  }

  const output = {};
  for (const icon of Object.keys(document.icons).sort()) {
    if (!NAME.test(icon) || !Object.hasOwn(baseline.icons, icon)) {
      refuse('ANNOTATION_INVALID', `нет авторского семейства ${icon}`);
    }
    const variants = document.icons[icon];
    if (!record(variants) || Object.keys(variants).length === 0 ||
        Object.keys(variants).some(variant => !VARIANTS.includes(variant))) {
      refuse('ANNOTATION_INVALID', `${icon}: требуются объявленные Outline/Filled варианты`);
    }
    for (const variant of VARIANTS.filter(item => Object.hasOwn(variants, item))) {
      const declaration = variants[variant];
      const label = `${icon}/${variant}`;
      fields(declaration, ['masterSha256', 'pathFingerprintSha256', 'parts', 'gesture'], label);
      const source = baseline.icons[icon][variant];
      if (!HASH.test(declaration.masterSha256) || !HASH.test(declaration.pathFingerprintSha256) ||
          declaration.masterSha256 !== source.author.masterSha256 ||
          declaration.pathFingerprintSha256 !== source.author.pathFingerprintSha256) {
        refuse('MASTER_MISMATCH', `${label}: raw master и path receipt не совпадают`);
      }
      if (!Array.isArray(declaration.parts) ||
          declaration.parts.length !== source.sourceContract.parts.length || !declaration.parts.length) {
        refuse('PARTS_INVALID', `${label}: каждая авторская path обязана иметь ровно одну часть`);
      }
      const ids = new Set();
      const byIndex = new Map();
      for (const part of declaration.parts) {
        fields(part, ['pathIndex', 'id', 'role', 'anchor', 'anchorMeaning'], `${label}.part`);
        if (!Number.isSafeInteger(part.pathIndex) || part.pathIndex < 0 ||
            part.pathIndex >= source.sourceContract.parts.length || byIndex.has(part.pathIndex) ||
            typeof part.id !== 'string' || !NAME.test(part.id) || ids.has(part.id) ||
            part.role !== 'control' || part.anchorMeaning !== 'canvas-center' ||
            !Array.isArray(part.anchor) || part.anchor.length !== 2 ||
            part.anchor.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
            part.anchor[0] !== 0.5 || part.anchor[1] !== 0.5) {
          refuse('PARTS_INVALID', `${label}: невалидные index/id/role или явно объявленный canvas-center anchor`);
        }
        ids.add(part.id);
        byIndex.set(part.pathIndex, part);
      }
      const parts = source.sourceContract.parts.map((part, index) => {
        const annotation = byIndex.get(index);
        if (!annotation || part.zIndex !== index) refuse('PARTS_INVALID', `${label}: нарушено покрытие или z-order`);
        return { ...part, id: annotation.id, identity: 'declared', role: annotation.role,
          anchor: [...annotation.anchor], anchorSource: 'declared' };
      });
      const gestures = clockwiseCycle(icon, variant, declaration.gesture, parts);
      const annotationSha256 = createHash('sha256').update(stableJSON({
        schemaVersion: document.schemaVersion, source: document.source, icon, variant,
        declaration, gestures,
      })).digest('hex');
      output[label] = {
        ...source.sourceContract,
        parts,
        anatomy: { version: 1, annotationSha256, masterSha256: declaration.masterSha256,
          pathFingerprintSha256: declaration.pathFingerprintSha256 },
        gestures,
      };
    }
  }
  return freezeTree(output);
}
