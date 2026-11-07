import { parsePathData } from './path-data.js';

/** Закреплённые literal subpaths; геометрию разбирает один canonical parser. */
export function closedSourceContourLiterals(d) {
  const segments = parsePathData(d);
  const starts = [...d.matchAll(/[Mm]/g)].map(match => match.index);
  if (!starts.length || /m/.test(d) || segments.filter(segment => segment.cmd === 'M').length !== starts.length) {
    throw new Error('source-contours: нужны явно абсолютные M; relative moveto меняет начало отдельного фрагмента');
  }
  let open = false;
  for (const segment of segments) {
    if (segment.cmd === 'M') {
      if (open) throw new Error('source-contours: каждый выбранный contour обязан быть закрыт');
      open = true;
    } else if (!open) {
      throw new Error('source-contours: команда вне закрытого contour');
    } else if (segment.cmd === 'Z') open = false;
  }
  if (open) throw new Error('source-contours: открытый contour');
  starts[0] = 0;
  return starts.map((start, index) => d.slice(start, starts[index + 1] ?? d.length));
}
