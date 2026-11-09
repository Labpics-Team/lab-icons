type Point = readonly [number, number];
/** @internal Поддержанная grammar sealed compiler packet. */
export interface CapsulePathContour {
  readonly commands: string;
  readonly points: readonly Point[];
  readonly rates: readonly number[];
}
/** @internal Число точек одной канонической SVG-команды. */
export const CAPSULE_OPERAND_COUNTS: Readonly<Record<string, number>> = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };

/** @internal Единственная арифметика и сериализация; factory уже проверила grammar/operands. */
export function prepareCapsulePath<T extends CapsulePathContour>(contours: readonly T[],
  validate?: (contour: T, points: readonly Point[]) => void): (width: number) => string {
  const program = contours.map(contour => {
    let index = 0;
    const operands: [prefix: string, x: number, y: number, rate: number][] = [];
    for (const command of contour.commands) {
      const count = CAPSULE_OPERAND_COUNTS[command]!;
      for (let offset = 0; offset < count; offset++) {
        const point = contour.points[index];
        operands.push([offset ? ' ' : command, point![0], point![1], contour.rates[index]!]);
        index++;
      }
    }
    return { contour, operands };
  });
  return width => {
    const delta = width - 1;
    let d = '';
    for (const { contour, operands } of program) {
      const points: Point[] | undefined = validate ? [] : undefined;
      for (const [prefix, x, y, rate] of operands) {
        const adjusted = x + delta * rate;
        d += `${prefix}${adjusted} ${y}`;
        points?.push([adjusted, y]);
      }
      d += 'Z';
      if (validate) validate(contour, points!);
    }
    return d;
  };
}
