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

/** Loading и typing используют одни и те же три отдельные точки. Меню не
 * наследует их смысл только из совпадения геометрии. Оболочка не анимируется. */
function activityTriad(icon, variant, declaration, parts) {
  fields(declaration, ['law', 'purpose', 'partIds'], `${icon}/${variant}.gesture`);
  if (!['loading', 'typing'].includes(declaration.purpose)) {
    refuse('LAW_SEMANTICS_UNSUPPORTED', `${icon}/${variant}: activity.triad требует явно объявленный loading или typing`);
  }
  if (!Array.isArray(declaration.partIds) || declaration.partIds.length !== 3 ||
      new Set(declaration.partIds).size !== 3 || declaration.partIds.some(id => {
        const part = parts.find(part => part.id === id);
        return !part || part.role !== 'content' || part.topologySignature.includes('|') ||
          !part.topologySignature.endsWith('Z');
      }) || parts.some(part => !declaration.partIds.includes(part.id) && part.role !== 'container')) {
    refuse('LAW_TOPOLOGY_UNSUPPORTED', `${icon}/${variant}: activity.triad требует три адресуемых замкнутых content части и неподвижные container части`);
  }
  const muted = 0.35;
  const tracks = declaration.partIds.map((partId, index) => ({
    partId, kind: 'opacity', unit: 'fraction', interpolation: 'linear',
    stops: [
      { at: 0, value: 1 }, { at: 1 / 12, value: muted },
      ...(index === 0 ? [] : [{ at: (1 + index * 3) / 12, value: muted }]),
      { at: (2 + index * 3) / 12, value: 1 },
      { at: (4 + index * 3) / 12, value: muted },
      ...(index === 2 ? [] : [{ at: 10 / 12, value: muted }]),
      { at: 1, value: 1 },
    ],
  }));
  const gestures = [
    { id: `${icon}.activity`, kind: 'cycle',
      meaning: declaration.purpose === 'loading' ? 'Один упорядоченный цикл загрузки; точки сохраняют авторскую форму.' : 'Один упорядоченный цикл набора сообщения; оболочка остаётся неподвижной.',
      partIds: [...declaration.partIds], progress: 'normalized-0-to-1', tracks },
    { id: `${icon}.idle`, kind: 'state', meaning: 'Восстановить неподвижные авторские точки с полной непрозрачностью.',
      partIds: [...declaration.partIds], progress: 'normalized-0-to-1',
      tracks: tracks.map(track => ({ ...track, stops: [{ at: 0, value: 1 }, { at: 1, value: 1 }] })) },
  ];
  for (const gesture of gestures) validateMotionGesture(gesture);
  return gestures;
}

/** Полосы явно упорядочены от speaker наружу; одна полоса — один закрытый contour. */
function signalLevels(icon, variant, declaration, parts) {
  fields(declaration, ['law', 'purpose', 'containerPartId', 'partIds'], `${icon}/${variant}.gesture`);
  if (declaration.purpose !== 'volume') {
    refuse('LAW_SEMANTICS_UNSUPPORTED', `${icon}/${variant}: signal.levels требует явно объявленный volume`);
  }
  if (Array.isArray(declaration.partIds) && declaration.partIds.some(Array.isArray)) {
    refuse('LAW_COMPOSITION_UNSUPPORTED', `${icon}/${variant}: flat parts не обеспечивают group opacity многоконтурной полосы`);
  }
  const container = parts.find(part => part.id === declaration.containerPartId);
  if (!container || container.role !== 'container' ||
      !Array.isArray(declaration.partIds) || !declaration.partIds.length ||
      new Set(declaration.partIds).size !== declaration.partIds.length ||
      parts.length !== declaration.partIds.length + 1 || declaration.partIds.some(id => {
        const part = parts.find(part => part.id === id);
        return !part || part.role !== 'content' || part.topologySignature.includes('|') ||
          !part.topologySignature.endsWith('Z');
      })) {
    refuse('LAW_TOPOLOGY_UNSUPPORTED', `${icon}/${variant}: signal.levels требует независимые закрытые content полосы и один неподвижный container`);
  }
  const count = declaration.partIds.length;
  const gesture = {
    id: `${icon}.level`, kind: 'state',
    meaning: 'Уровень громкости: ближние полосы становятся видимыми раньше дальних; speaker сохраняется.',
    partIds: [...declaration.partIds], progress: 'normalized-0-to-1', restProgress: 1,
    tracks: declaration.partIds.map((partId, index) => {
      const start = index / count, end = (index + 1) / count;
      return { partId, kind: 'opacity', unit: 'fraction', interpolation: 'linear',
        stops: [{ at: 0, value: 0 }, ...(start > 0 ? [{ at: start, value: 0 }] : []),
          { at: end, value: 1 }, ...(end < 1 ? [{ at: 1, value: 1 }] : [])],
      };
    }),
  };
  validateMotionGesture(gesture);
  return [gesture];
}

function compileLaw(icon, variant, declaration, parts) {
  if (declaration?.law === 'cycle.clockwise') return clockwiseCycle(icon, variant, declaration, parts);
  if (declaration?.law === 'activity.triad') return activityTriad(icon, variant, declaration, parts);
  if (declaration?.law === 'signal.levels') return signalLevels(icon, variant, declaration, parts);
  refuse('LAW_UNSUPPORTED', `${icon}/${variant}: закон ${declaration?.law} не объявлен`);
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
        const anchored = part?.role === 'control';
        fields(part, anchored ? ['pathIndex', 'id', 'role', 'anchor', 'anchorMeaning'] : ['pathIndex', 'id', 'role'], `${label}.part`);
        if (!Number.isSafeInteger(part.pathIndex) || part.pathIndex < 0 ||
            part.pathIndex >= source.sourceContract.parts.length || byIndex.has(part.pathIndex) ||
            typeof part.id !== 'string' || !NAME.test(part.id) || ids.has(part.id) ||
            !['control', 'content', 'container'].includes(part.role) || anchored && (part.anchorMeaning !== 'canvas-center' ||
            !Array.isArray(part.anchor) || part.anchor.length !== 2 ||
            part.anchor.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
            part.anchor[0] !== 0.5 || part.anchor[1] !== 0.5)) {
          refuse('PARTS_INVALID', `${label}: невалидные index/id/role или явно объявленный canvas-center anchor`);
        }
        ids.add(part.id);
        byIndex.set(part.pathIndex, part);
      }
      const parts = source.sourceContract.parts.map((part, index) => {
        const annotation = byIndex.get(index);
        if (!annotation || part.zIndex !== index) refuse('PARTS_INVALID', `${label}: нарушено покрытие или z-order`);
        return { ...part, id: annotation.id, identity: 'declared', role: annotation.role,
          ...(annotation.anchor && { anchor: [...annotation.anchor], anchorSource: 'declared' }) };
      });
      const gestures = compileLaw(icon, variant, declaration.gesture, parts);
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
