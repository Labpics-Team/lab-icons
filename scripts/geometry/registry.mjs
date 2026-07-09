// Реестр геометрии lab-icons: каноны и производные.
// Правило: направленные иконки существуют в ОДНОМ каноне (forward/redo),
// остальные направления — аффинные производные. Расхождение зеркал невозможно by construction.

// ── канонические строки общих компонентов ──
// кольцо *-circle Outline: R=11, t=1.5, центр (12,12)
export const RING =
  'M1 12a11 11 0 1 0 22 0a11 11 0 1 0 -22 0ZM2.5 12a9.5 9.5 0 1 1 19 0a9.5 9.5 0 1 1 -19 0Z';
// диск *-circle Filled
export const DISC = 'M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22';

// ── канон стрелки в круге (ось y=12) ──
// палка: левый край x=8, полуширина 1, кап r=1, правый кап (14.5,12) утоплен в голову
// голова: хвосты (11.6, 12∓3.5), нотч (15.1,12), капы r=1, кончик (17.2, 12∓0.7)
export const CIRCLE_ARROW_STEM = 'M8 13L14.5 13A1 1 0 0 0 14.5 11L8 11A1 1 0 0 0 8 13Z';
export const CIRCLE_ARROW_HEAD =
  'M11.6 8.5L15.1 12L11.6 15.5A1 1 0 0 0 13 16.9L17.2 12.7A1 1 0 0 0 17.2 11.3L13 7.1A1 1 0 0 0 11.6 8.5Z';
// сваренная дырка для Filled (evenodd не терпит перекрытий): union(палка, голова) одним подпутём
// P1=(14.1,11)/P2=(14.1,13) — пересечения кромок палки с внутренними рёбрами головы
export const CIRCLE_ARROW_WELDED =
  'M8 11L14.1 11L11.6 8.5A1 1 0 0 1 13 7.1L17.2 11.3A1 1 0 0 1 17.2 12.7L13 16.9A1 1 0 0 1 11.6 15.5L14.1 13L8 13A1 1 0 0 1 8 11Z';

// ── канон шеврона (ось y=12; вес Outline 0.9/1.8, вес Filled 1.2/2.4, в круге 1.0/2.0) ──
export const CHEVRON_OUTLINE =
  'M9.09 17.48L14.57 12L9.09 6.52A.9 .9 0 0 1 10.36 5.25L15.84 10.73A1.8 1.8 0 0 1 15.84 13.27L10.36 18.75A.9 .9 0 0 1 9.09 17.48Z';
export const CHEVRON_FILLED =
  'M8.98 16.84L13.82 12L8.98 7.16A1.2 1.2 0 0 1 10.68 5.46L15.52 10.3A2.4 2.4 0 0 1 15.52 13.7L10.68 18.54A1.2 1.2 0 0 1 8.98 16.84Z';
export const CIRCLE_CHEVRON =
  'M10.33 15.17L13.5 12L10.33 8.83A1 1 0 0 1 11.74 7.42L14.92 10.6A2 2 0 0 1 14.92 13.4L11.74 16.58A1 1 0 0 1 10.33 15.17Z';

// ── аффинные операции (24×24 canvas) ──
export const OPS = {
  mirrorX: { a: -1, b: 0, c: 0, d: 1, e: 24, f: 0 },   // ↔
  mirrorY: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 24 },   // ↕
  rotCCW:  { a: 0, b: -1, c: 1, d: 0, e: 0, f: 24 },   // forward → up
  rotCW:   { a: 0, b: 1, c: -1, d: 0, e: 24, f: 0 },   // forward → down
};

// ── производные: имя → { from, op } ──
// (glyph-only для *-circle: кольцо/диск не трансформируются, а подставляются каноном)
export const DERIVED = {
  'arrow-back':            { from: 'arrow-forward', op: 'mirrorX' },
  'arrow-up':              { from: 'arrow-forward', op: 'rotCCW' },
  'arrow-down':            { from: 'arrow-forward', op: 'rotCW' },
  'arrow-back-circle':     { from: 'arrow-forward-circle', op: 'mirrorX' },
  'arrow-up-circle':       { from: 'arrow-forward-circle', op: 'rotCCW' },
  'arrow-down-circle':     { from: 'arrow-forward-circle', op: 'rotCW' },
  'chevron-back':          { from: 'chevron-forward', op: 'mirrorX' },
  'chevron-up':            { from: 'chevron-forward', op: 'rotCCW' },
  'chevron-down':          { from: 'chevron-forward', op: 'rotCW' },
  'chevron-back-circle':   { from: 'chevron-forward-circle', op: 'mirrorX' },
  'chevron-up-circle':     { from: 'chevron-forward-circle', op: 'rotCCW' },
  'chevron-down-circle':   { from: 'chevron-forward-circle', op: 'rotCW' },
  'play-back':             { from: 'play-forward', op: 'mirrorX' },
  'play-back-circle':      { from: 'play-forward-circle', op: 'mirrorX' },
  'play-skip-back':        { from: 'play-skip-forward', op: 'mirrorX' },
  'play-skip-back-circle': { from: 'play-skip-forward-circle', op: 'mirrorX' },
  'arrow-undo':            { from: 'arrow-redo', op: 'mirrorX' },
  'arrow-undo-circle':     { from: 'arrow-redo-circle', op: 'mirrorX' },
};
