import { createHash } from 'node:crypto';
import { iconGeometry } from '../../src/core/icon-geometry.js';
import { validateMotionGesture } from '../../src/core/motion-sampler.js';
import { compileAuthorVariation } from './author-variation.js';
import { compileAuthorCapsule, projectAuthorCapsuleRuntime } from './author-capsule.js';
import { projectAuthorSourceContours } from './author-source-contours.js';
import { compileAuthorAnnulus, projectAuthorAnnulusRuntime, compileAuthorContentVariation,
  projectAuthorContentVariationRuntime } from './author-annulus.js';
import defaultGrid from '../../semantics/grid.json' with { type: 'json' };

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
 * Один оборот вокруг объявленного центра. Elapsed-time выбирает отдельную
 * стрелку и сохраняет container части; соединённые стрелки не разделяются.
 */
function clockwiseCycle(icon, variant, declaration, parts) {
  const elapsed = Object.hasOwn(declaration, 'purpose');
  fields(declaration, ['law', 'partId', ...(elapsed ? ['purpose'] : [])], `${icon}/${variant}.gesture`);
  if (declaration.law !== 'cycle.clockwise') {
    refuse('LAW_UNSUPPORTED', `${icon}/${variant}: закон ${declaration.law} не объявлен`);
  }
  if (elapsed && declaration.purpose !== 'elapsed-time') {
    refuse('LAW_SEMANTICS_UNSUPPORTED', `${icon}/${variant}: cycle.clockwise поддерживает явно объявленный elapsed-time`);
  }
  const part = parts.find(item => item.id === declaration.partId);
  if (!part || part.role !== 'control' ||
      part.topologySignature.includes('|') || !part.topologySignature.endsWith('Z') ||
      (elapsed ? parts.length < 2 || part.fillRule !== 'nonzero' ||
        parts.some(item => item.id !== part.id && item.role !== 'container') : parts.length !== 1)) {
    refuse('LAW_TOPOLOGY_UNSUPPORTED', elapsed
      ? `${icon}/${variant}: cycle.clockwise требует отдельную закрытую control часть и неподвижные container части`
      : `${icon}/${variant}: cycle.clockwise требует одну целую замкнутую управляющую часть`);
  }
  const gesture = {
    id: `${icon}.${elapsed ? 'advance' : 'cycle'}`,
    kind: 'cycle',
    meaning: elapsed
      ? 'Один интервал таймера: отдельная авторская стрелка делает оборот по часовой стрелке из исходной позы; циферблат остаётся неподвижным.'
      : 'Один оборот команды обновления по часовой стрелке; промежуточную позу можно развернуть или продолжить.',
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

/** Направление задано автором; общий пик равен 1/8 соответствующей стороны
 * viewBox. Оболочка с внутренним знаком требует отдельно адресуемой анатомии. */
function directionNudge(icon, variant, declaration, parts, source) {
  fields(declaration, ['law', 'partId', 'direction'], `${icon}/${variant}.gesture`);
  if (!['left', 'right', 'up', 'down'].includes(declaration.direction)) {
    refuse('LAW_SEMANTICS_UNSUPPORTED', `${icon}/${variant}: direction.nudge требует явно объявленное физическое направление left/right/up/down`);
  }
  const part = parts.find(item => item.id === declaration.partId);
  if (!part || parts.length !== 1 || part.role !== 'control' ||
      part.topologySignature.includes('|') || !part.topologySignature.endsWith('Z')) {
    refuse('LAW_TOPOLOGY_UNSUPPORTED', `${icon}/${variant}: direction.nudge требует одну целую замкнутую управляющую часть`);
  }
  const { width, height } = iconGeometry(source.artifactSvg).viewBox;
  const horizontal = declaration.direction === 'left' || declaration.direction === 'right';
  const sign = declaration.direction === 'left' || declaration.direction === 'up' ? -1 : 1;
  const gesture = {
    id: `${icon}.nudge`, kind: 'cycle',
    meaning: 'Один толчок в явно объявленном направлении с возвратом в авторскую позу; промежуточное движение можно развернуть или продолжить.',
    partIds: [part.id], progress: 'normalized-0-to-1',
    tracks: [{ partId: part.id, kind: 'translate', axis: horizontal ? 'x' : 'y',
      unit: 'viewBox', interpolation: 'linear',
      stops: [{ at: 0, value: 0 }, { at: 0.5, value: sign * (horizontal ? width : height) / 8 }, { at: 1, value: 0 }] }],
  };
  validateMotionGesture(gesture);
  return [gesture];
}

/** Подтверждение меняет видимость целой авторской отметки. Оболочка и её
 * контрформы сохраняются; отрицательный контур внутри Filled body не является
 * самостоятельной отметкой и не получает этот закон. */
function confirmationPresence(icon, variant, declaration, parts) {
  fields(declaration, ['law', 'purpose', 'partId'], `${icon}/${variant}.gesture`);
  if (declaration.purpose !== 'confirmation') {
    refuse('LAW_SEMANTICS_UNSUPPORTED', `${icon}/${variant}: confirmation.presence требует явно объявленное подтверждение`);
  }
  const mark = parts.find(part => part.id === declaration.partId);
  if (!mark || mark.role !== 'content' || mark.fillRule !== 'nonzero' ||
      mark.topologySignature.includes('|') || !mark.topologySignature.endsWith('Z') ||
      parts.some(part => part.id !== mark.id && part.role !== 'container')) {
    refuse('LAW_TOPOLOGY_UNSUPPORTED', `${icon}/${variant}: confirmation.presence требует одну отдельную закрытую отметку и неподвижные container части`);
  }
  const gesture = {
    id: `${icon}.presence`, kind: 'state',
    meaning: 'Подтверждение: показать или скрыть целую авторскую отметку, сохраняя оболочку этого символа.',
    partIds: [mark.id], progress: 'normalized-0-to-1', restProgress: 1,
    tracks: [{ partId: mark.id, kind: 'opacity', unit: 'fraction', interpolation: 'linear',
      stops: [{ at: 0, value: 0 }, { at: 1, value: 1 }] }],
  };
  validateMotionGesture(gesture);
  return [gesture];
}

/** Входящее уведомление двигает только явно объявленный clapper. Шарнир в
 * masters не задан: сдвиг не добавляет pivot и сохраняет bell/badge. Доля
 * ширины clapper — общая калибровка закона, а не координатная правка иконки. */
const NOTIFICATION_RING_WIDTH_RATIO = 1 / 4;
function notificationRing(icon, variant, declaration, parts, source) {
  fields(declaration, ['law', 'purpose', 'partId'], `${icon}/${variant}.gesture`);
  if (declaration.purpose !== 'incoming-notification') {
    refuse('LAW_SEMANTICS_UNSUPPORTED', `${icon}/${variant}: notification.ring требует явно объявленное incoming-notification`);
  }
  const clapper = parts.find(part => part.id === declaration.partId);
  if (!clapper || clapper.role !== 'content' || clapper.fillRule !== 'nonzero' ||
      clapper.topologySignature.includes('|') || !clapper.topologySignature.endsWith('Z') ||
      parts.length < 2 || parts.some(part => part.id !== clapper.id && part.role !== 'container')) {
    refuse('LAW_TOPOLOGY_UNSUPPORTED', `${icon}/${variant}: notification.ring требует один отдельный закрытый content clapper и неподвижные container части`);
  }
  const width = iconGeometry(source.artifactSvg).paths[clapper.zIndex]?.width;
  if (!Number.isFinite(width) || width <= 0) {
    refuse('LAW_TOPOLOGY_UNSUPPORTED', `${icon}/${variant}: clapper обязан иметь конечную положительную ширину`);
  }
  const amplitude = width * NOTIFICATION_RING_WIDTH_RATIO;
  const gesture = {
    id: `${icon}.ring`, kind: 'cycle',
    meaning: 'Входящее уведомление: один затухающий горизонтальный цикл язычка; корпус и badge остаются неподвижными.',
    partIds: [clapper.id], progress: 'normalized-0-to-1', restProgress: 0,
    tracks: [{ partId: clapper.id, kind: 'translate', axis: 'x', unit: 'viewBox', interpolation: 'linear',
      stops: [0, 1, -1, 0.5, -0.5, 0].map((factor, index) => ({ at: index / 5, value: amplitude * factor })) }],
  };
  validateMotionGesture(gesture);
  return [gesture];
}

function compileLaw(icon, variant, declaration, parts, source) {
  if (declaration?.law === 'cycle.clockwise') return clockwiseCycle(icon, variant, declaration, parts);
  if (declaration?.law === 'activity.triad') return activityTriad(icon, variant, declaration, parts);
  if (declaration?.law === 'signal.levels') return signalLevels(icon, variant, declaration, parts);
  if (declaration?.law === 'confirmation.presence') return confirmationPresence(icon, variant, declaration, parts);
  if (declaration?.law === 'direction.nudge') return directionNudge(icon, variant, declaration, parts, source);
  if (declaration?.law === 'notification.ring') return notificationRing(icon, variant, declaration, parts, source);
  refuse('LAW_UNSUPPORTED', `${icon}/${variant}: закон ${declaration?.law} не объявлен`);
}

/**
 * Смысл задаётся явно, а geometry остаётся у проверенного master. Индексы
 * адресуют только этот закреплённый экспорт; наружу выходят стабильные part.id.
 * Весь документ проверяется до выдачи проекции, без частичного admission.
 */
function compileAuthorAnatomyResult(baseline, document, grid, options) {
  if (!record(options) || Object.keys(options).some(key => key !== 'scope') ||
      !['source', 'motion'].includes(options.scope)) refuse('ANNOTATION_INVALID', 'scope анатомии: source или motion');
  fields(document, ['schemaVersion', 'source', 'icons'], 'document');
  fields(document.source, ['fileKey', 'version'], 'source');
  if (document.schemaVersion !== 1 || !record(document.icons)) {
    refuse('ANNOTATION_INVALID', 'требуется versioned документ анатомии');
  }
  if (!baseline?.source || document.source.fileKey !== baseline.source.fileKey ||
      document.source.version !== baseline.source.version) {
    refuse('SOURCE_MISMATCH', 'анатомия относится к другому файлу или версии Figma');
  }

  const output = {}, evidence = {}, contentEvidence = {}, capsuleEvidence = {};
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
      fields(declaration, ['masterSha256', 'pathFingerprintSha256', 'parts', 'gesture',
        ...(Object.hasOwn(declaration, 'composition') ? ['composition'] : []),
        ...(Object.hasOwn(declaration, 'variation') ? ['variation'] : []),
        ...(Object.hasOwn(declaration, 'scope') ? ['scope'] : []),
        ...(Object.hasOwn(declaration, 'contentVariation') ? ['contentVariation'] : [])], label);
      if (Object.hasOwn(declaration, 'scope') && (declaration.scope !== 'motion' ||
          declaration.variation || declaration.contentVariation || declaration.composition)) {
        refuse('ANNOTATION_INVALID', `${label}: motion scope не меняет геометрический source target`);
      }
      const source = baseline.icons[icon][variant];
      if (!HASH.test(declaration.masterSha256) || !HASH.test(declaration.pathFingerprintSha256) ||
          declaration.masterSha256 !== source.author.masterSha256 ||
          declaration.pathFingerprintSha256 !== source.author.pathFingerprintSha256) {
        refuse('MASTER_MISMATCH', `${label}: raw master и path receipt не совпадают`);
      }
      const compound = Object.hasOwn(declaration, 'composition');
      if (!Array.isArray(declaration.parts) ||
          !compound && declaration.parts.length !== source.sourceContract.parts.length || !declaration.parts.length) {
        refuse('PARTS_INVALID', `${label}: каждая авторская path обязана иметь ровно одну часть`);
      }
      const ids = new Set();
      const byIndex = new Map();
      for (const part of declaration.parts) {
        const anchored = part?.role === 'control';
        fields(part, compound ? ['pathIndex', 'contourIndices', 'id', 'role'] : anchored
          ? ['pathIndex', 'id', 'role', 'anchor', 'anchorMeaning'] : ['pathIndex', 'id', 'role'], `${label}.part`);
        if (!Number.isSafeInteger(part.pathIndex) || part.pathIndex < 0 ||
            part.pathIndex >= source.sourceContract.parts.length || !compound && byIndex.has(part.pathIndex) ||
            typeof part.id !== 'string' || !NAME.test(part.id) || ids.has(part.id) ||
            !(compound ? ['counter', 'container'] : ['control', 'content', 'container']).includes(part.role) || anchored && (part.anchorMeaning !== 'canvas-center' ||
            !Array.isArray(part.anchor) || part.anchor.length !== 2 ||
            part.anchor.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
            part.anchor[0] !== 0.5 || part.anchor[1] !== 0.5)) {
          refuse('PARTS_INVALID', `${label}: невалидные index/id/role или явно объявленный canvas-center anchor`);
        }
        ids.add(part.id);
        byIndex.set(part.pathIndex, part);
      }
      const parts = compound ? projectAuthorSourceContours(source, declaration.parts, declaration.composition, refuse)
        : source.sourceContract.parts.map((part, index) => {
        const annotation = byIndex.get(index);
        if (!annotation || part.zIndex !== index) refuse('PARTS_INVALID', `${label}: нарушено покрытие или z-order`);
        return { ...part, id: annotation.id, identity: 'declared', role: annotation.role,
          ...(annotation.anchor && { anchor: [...annotation.anchor], anchorSource: 'declared' }) };
      });
      if (compound && (declaration.gesture !== null || declaration.variation?.law !== 'capsule.width' || declaration.contentVariation)) {
        refuse('LAW_COMPOSITION_UNSUPPORTED', `${label}: compound contours не получают независимые layer effects`);
      }
      // Семантический закон не угадывается по форме. Source receipt выводится
      // из одного author spec, а полный annulus proof не входит в runtime contract.
      let variation;
      if (declaration.variation?.law === 'annulus.counter-scale') {
        fields(declaration.variation, ['law', 'parameter', 'enclosurePartId'], `${label}.variation`);
        const compiled = compileAuthorAnnulus(source, parts, { ...declaration.variation, variant,
          source: { ...document.source, masterSha256: declaration.masterSha256,
            pathFingerprintSha256: declaration.pathFingerprintSha256 } }, grid);
        variation = projectAuthorAnnulusRuntime(compiled);
        evidence[label] = compiled;
      } else if (declaration.variation?.law === 'capsule.width') {
        const compiled = compileAuthorCapsule(source, parts, declaration.variation, grid, declaration.composition);
        variation = projectAuthorCapsuleRuntime(compiled);
        capsuleEvidence[label] = compiled.evidence;
      } else if (declaration.variation) {
        variation = compileAuthorVariation(source, parts, declaration.variation, grid);
      }
      if (declaration.gesture === null && !variation) {
        refuse('LAW_UNSUPPORTED', `${label}: static parts требуют явного геометрического закона и grid policy`);
      }
      const gestures = declaration.gesture === null ? [] : compileLaw(icon, variant, declaration.gesture, parts, source);
      let contentVariation;
      if (declaration.contentVariation) {
        fields(declaration.contentVariation, ['law', 'parameters', 'enclosurePartId'], `${label}.contentVariation`);
        if (!variation || variation.law !== 'annulus.counter-scale' || !evidence[label]) {
          refuse('LAW_UNSUPPORTED', `${label}: contentScale требует уже доказанное авторское обрамление`);
        }
        const compiled = compileAuthorContentVariation(source, parts, { ...declaration.contentVariation, variant,
          source: { ...document.source, masterSha256: declaration.masterSha256,
            pathFingerprintSha256: declaration.pathFingerprintSha256 } }, grid, evidence[label]);
        contentVariation = projectAuthorContentVariationRuntime(compiled);
        contentEvidence[label] = compiled;
      }
      // Новый opt-in имеет собственный receipt; прежняя анатомия и её consumers
      // не меняются из-за добавления отдельно поставляемой деформации.
      const { contentVariation: _contentVariation, ...legacyDeclaration } = declaration;
      const annotationSha256 = createHash('sha256').update(stableJSON({
        schemaVersion: document.schemaVersion, source: document.source, icon, variant,
        declaration: legacyDeclaration, gestures, ...(variation && { variation }),
      })).digest('hex');
      if (declaration.scope === 'motion' && options.scope === 'source') continue;
      output[label] = {
        ...source.sourceContract,
        parts,
        ...(compound && { composition: { ...declaration.composition } }),
        anatomy: { version: 1, annotationSha256, masterSha256: declaration.masterSha256,
          pathFingerprintSha256: declaration.pathFingerprintSha256 },
        gestures,
        ...(variation && { variation }),
        ...(contentVariation && { contentVariation }),
      };
    }
  }
  return freezeTree({ contracts: output, evidence, contentEvidence, capsuleEvidence });
}

/** Существующие build consumers сохраняют прежнюю форму source contracts. */
export function compileAuthorAnatomy(baseline, document, grid = defaultGrid, options = { scope: 'source' }) {
  return compileAuthorAnatomyResult(baseline, document, grid, options).contracts;
}

/** Полный proof доступен build tooling без сериализации его в consumer runtime. */
export function compileAuthorAnatomyWithEvidence(baseline, document, grid = defaultGrid, options = { scope: 'source' }) {
  return compileAuthorAnatomyResult(baseline, document, grid, options);
}
