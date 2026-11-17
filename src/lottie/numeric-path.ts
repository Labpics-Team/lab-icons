export type LottiePoint = [number, number];
export interface LottieContour { v: LottiePoint[]; i: LottiePoint[]; o: LottiePoint[]; c: boolean }

/** Decode compiled opcodes directly. Source SVG parsing stays in the authoring compiler. */
export function numericLottieContours(commands: string, coordinates: ArrayLike<number>, selected?: readonly number[]): LottieContour[] {
  let offset = 0, contourIndex = -1;
  let contour: LottieContour | undefined, cursor: LottiePoint | undefined;
  const result: LottieContour[] = [];
  const point = (): LottiePoint => {
    const value: LottiePoint = [coordinates[offset++]!, coordinates[offset++]!];
    if (!value.every(Number.isFinite)) throw new TypeError('Lottie path needs finite numeric coordinates');
    return value;
  };
  const finish = () => {
    if (contour && (!selected || selected.includes(contourIndex))) result.push(contour);
    contour = undefined;
  };
  for (const command of commands) {
    if (command === 'M') {
      finish(); contourIndex++; cursor = point();
      contour = { v: [cursor], i: [[0, 0]], o: [[0, 0]], c: false };
      continue;
    }
    if (!contour || contour.c || !cursor) throw new TypeError('Lottie path command is outside an open subpath');
    if (command === 'L' || command === 'C') {
      const a = command === 'C' ? point() : undefined;
      const b = command === 'C' ? point() : undefined;
      const end = point();
      // Lottie uses zero relative handles for a straight segment. Its SVG
      // player emits a cubic with the same locus; edge antialiasing can differ.
      contour.o[contour.v.length - 1] = a ? [a[0] - cursor[0], a[1] - cursor[1]] : [0, 0];
      contour.v.push(end); contour.i.push(b ? [b[0] - end[0], b[1] - end[1]] : [0, 0]); contour.o.push([0, 0]);
      cursor = end;
    } else if (command === 'Z') {
      if (contour.v.length > 1 && cursor[0] === contour.v[0]![0] && cursor[1] === contour.v[0]![1]) {
        contour.i[0] = contour.i.pop()!; contour.v.pop(); contour.o.pop();
      }
      contour.c = true;
    } else throw new TypeError(`Unsupported compiled Lottie path opcode: ${command}`);
  }
  finish();
  if (offset !== coordinates.length || !result.length) throw new TypeError('Lottie path has an incomplete coordinate or contour table');
  return result;
}
