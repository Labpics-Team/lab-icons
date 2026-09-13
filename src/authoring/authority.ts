import gridJson from '../../semantics/grid.json';
import {
  buildDirectionalArrow,
  glyphOperatorTokens,
  glyphOpszRange,
  type NegativeSpaceKind,
  type NegativeSpaceMeasurementMethod,
  type RecipeResult,
} from '../ir/recipes.js';

export type DesignScalarUnit = 'normalized-canvas' | 'degrees' | 'ratio';

export interface DesignScalarTokenContract {
  readonly value: number;
  readonly unit: DesignScalarUnit;
  readonly source: string;
  readonly semanticEffect: string;
}

export type RecipeNumberDefault =
  | number
  | Readonly<{
      kind: 'max';
      value: number;
      opticalMinimum: 'minStroke' | 'minClearance';
    }>
  | Readonly<{
      kind: 'opticalMinimum';
      value: 'minStroke' | 'minClearance';
    }>;

export type RecipeParameterContract =
  | Readonly<{
      kind: 'number';
      unit: 'normalized-canvas' | 'degrees' | 'opsz-px';
      domain: Readonly<{
        min?: number;
        minExclusive?: number;
        max?: number;
        integer?: true;
        opticalMinimum?: 'minStroke' | 'minClearance';
      }>;
      default: RecipeNumberDefault;
      semanticEffect: string;
    }>
  | Readonly<{
      kind: 'enum';
      values: readonly string[];
      default: string;
      semanticEffect: string;
    }>
  | Readonly<{
      kind: 'boolean';
      default: boolean;
      semanticEffect: string;
    }>;

export interface RegisteredRecipeContract {
  readonly version: number;
  readonly parameters: Readonly<Record<string, RecipeParameterContract>>;
  readonly outputs: Readonly<{
    partIds: readonly string[];
    anchorIds: readonly string[];
    negativeSpace: readonly Readonly<{
      kind: NegativeSpaceKind;
      measurementMethod: NegativeSpaceMeasurementMethod;
      participants: readonly string[];
    }>[];
  }>;
}

type RegisteredRecipeBuilder = (
  parameters: Readonly<Record<string, number | string | boolean>>,
) => RecipeResult;

interface GridContract {
  readonly ratios: {
    readonly margin: number;
    readonly keylines: {
      readonly circle: number;
      readonly square: number;
      readonly wide: Readonly<{ width: number; height: number }>;
      readonly tall: Readonly<{ width: number; height: number }>;
    };
    readonly strokeWidth: Readonly<{
      base: number;
      bold: number;
      enclosureRing: number;
      capRadius: number;
    }>;
    readonly angleScale: readonly number[];
    readonly clearanceMin: number;
  };
}

interface OperatorTokenContract {
  readonly shared: Readonly<{ weight: number; margin: number }>;
  readonly directional: Readonly<{
    margin: number;
    headLength: number;
    headSpan: number;
    shaftLength: number;
  }>;
  readonly strike: Readonly<{ angle: number; overshoot: number }>;
  readonly rays: Readonly<{ bodyRadius: number }>;
  readonly note: Readonly<{
    headRadiusX: number;
    headRadiusY: number;
    headAngle: number;
    stemLength: number;
  }>;
}

const grid = gridJson as unknown as GridContract;
const operatorTokens = glyphOperatorTokens as unknown as OperatorTokenContract;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function token(
  value: number,
  unit: DesignScalarUnit,
  source: string,
  semanticEffect: string,
): DesignScalarTokenContract {
  return { value, unit, source, semanticEffect };
}

function gridAngle(value: number): DesignScalarTokenContract {
  const index = grid.ratios.angleScale.indexOf(value);
  if (index < 0) {
    throw new Error(`angle token ${value} отсутствует в semantics/grid.json#ratios.angleScale`);
  }
  return token(
    grid.ratios.angleScale[index]!,
    'degrees',
    `semantics/grid.json#ratios.angleScale[${index}]`,
    'Каноническое направление конструктивной геометрии.',
  );
}

export const designResidualRecipeContract = deepFreeze({
  superellipse: {
    continuity: 'C1',
    tangency: 'central-difference-hermite',
    domain: {
      rx: { minExclusive: 0, max: 0.5 },
      ry: { minExclusive: 0, max: 0.5 },
      exponent: { min: 2, max: 8 },
      rotation: { min: -180, max: 180 },
    },
  },
} as const);

export const designScalarTokens = deepFreeze({
  'canvas.zero': token(0, 'normalized-canvas', 'intrinsic:normalized-canvas-origin', 'Нулевая длина или радиус только там, где поле допускает ноль.'),
  'canvas.half': token(0.5, 'normalized-canvas', 'intrinsic:normalized-canvas-midpoint', 'Половина нормализованной канвы.'),
  'grid.margin': token(grid.ratios.margin, 'normalized-canvas', 'semantics/grid.json#ratios.margin', 'Базовое внешнее поле.'),
  'grid.clearance.min': token(grid.ratios.clearanceMin, 'normalized-canvas', 'semantics/grid.json#ratios.clearanceMin', 'Минимальный охранный негативный просвет.'),
  'grid.stroke.base': token(grid.ratios.strokeWidth.base, 'normalized-canvas', 'semantics/grid.json#ratios.strokeWidth.base', 'Базовый Outline-вес.'),
  'grid.stroke.bold': token(grid.ratios.strokeWidth.bold, 'normalized-canvas', 'semantics/grid.json#ratios.strokeWidth.bold', 'Bold-вес штриховой формы.'),
  'grid.stroke.enclosure': token(grid.ratios.strokeWidth.enclosureRing, 'normalized-canvas', 'semantics/grid.json#ratios.strokeWidth.enclosureRing', 'Оптически облегчённый вес enclosure.'),
  'grid.stroke.cap-radius': token(grid.ratios.strokeWidth.capRadius, 'normalized-canvas', 'semantics/grid.json#ratios.strokeWidth.capRadius', 'Радиус round-cap базового штриха.'),
  'grid.keyline.circle.radius': token(grid.ratios.keylines.circle / 2, 'normalized-canvas', 'semantics/grid.json#ratios.keylines.circle/2', 'Радиус круговой keyline.'),
  'grid.keyline.square.size': token(grid.ratios.keylines.square, 'normalized-canvas', 'semantics/grid.json#ratios.keylines.square', 'Размер квадратной keyline.'),
  'grid.keyline.wide.width': token(grid.ratios.keylines.wide.width, 'normalized-canvas', 'semantics/grid.json#ratios.keylines.wide.width', 'Ширина wide-keyline.'),
  'grid.keyline.wide.height': token(grid.ratios.keylines.wide.height, 'normalized-canvas', 'semantics/grid.json#ratios.keylines.wide.height', 'Высота wide-keyline.'),
  'grid.keyline.tall.width': token(grid.ratios.keylines.tall.width, 'normalized-canvas', 'semantics/grid.json#ratios.keylines.tall.width', 'Ширина tall-keyline.'),
  'grid.keyline.tall.height': token(grid.ratios.keylines.tall.height, 'normalized-canvas', 'semantics/grid.json#ratios.keylines.tall.height', 'Высота tall-keyline.'),
  'angle.zero': gridAngle(0),
  'angle.30': gridAngle(30),
  'angle.45': gridAngle(45),
  'angle.90': gridAngle(90),
  'angle.135': gridAngle(135),
  'operator.strike.angle': token(operatorTokens.strike.angle, 'degrees', 'GLYPH_OPERATOR_TOKENS.strike.angle', 'Канонический наклон strike-decorator.'),
  'operator.directional.margin': token(operatorTokens.directional.margin, 'normalized-canvas', 'GLYPH_OPERATOR_TOKENS.directional.margin', 'Внешнее поле directional-family.'),
  'operator.directional.head-length': token(operatorTokens.directional.headLength, 'normalized-canvas', 'GLYPH_OPERATOR_TOKENS.directional.headLength', 'Длина головки directional-family.'),
  'operator.directional.head-span': token(operatorTokens.directional.headSpan, 'normalized-canvas', 'GLYPH_OPERATOR_TOKENS.directional.headSpan', 'Раскрытие головки directional-family.'),
  'operator.directional.shaft-length': token(operatorTokens.directional.shaftLength, 'normalized-canvas', 'GLYPH_OPERATOR_TOKENS.directional.shaftLength', 'Длина shaft directional-arrow.'),
  'operator.rays.body-radius': token(operatorTokens.rays.bodyRadius, 'normalized-canvas', 'GLYPH_OPERATOR_TOKENS.rays.bodyRadius', 'Радиус тела radial-rays family.'),
  'operator.note.head-radius-x': token(operatorTokens.note.headRadiusX, 'normalized-canvas', 'GLYPH_OPERATOR_TOKENS.note.headRadiusX', 'Горизонтальный радиус головки ноты.'),
  'operator.note.head-radius-y': token(operatorTokens.note.headRadiusY, 'normalized-canvas', 'GLYPH_OPERATOR_TOKENS.note.headRadiusY', 'Вертикальный радиус головки ноты.'),
  'operator.note.head-angle': token(operatorTokens.note.headAngle, 'degrees', 'GLYPH_OPERATOR_TOKENS.note.headAngle', 'Наклон головки ноты.'),
  'operator.note.stem-length': token(operatorTokens.note.stemLength, 'normalized-canvas', 'GLYPH_OPERATOR_TOKENS.note.stemLength', 'Длина stem ноты.'),
  'curve.superellipse.exponent-min': token(designResidualRecipeContract.superellipse.domain.exponent.min, 'ratio', 'labpics.design-spec/2#residualRecipes.superellipse.domain.exponent.min', 'Нижняя граница exponent superellipse; при 2 форма совпадает с эллипсом.'),
} as const);

export type DesignScalarTokenId = keyof typeof designScalarTokens;

const directionalParameters = deepFreeze({
  orientation: {
    kind: 'enum',
    values: ['up', 'down', 'back', 'forward'],
    default: 'forward',
    semanticEffect: 'Поворот одной directional-анатомии без отдельной геометрии.',
  },
  opsz: {
    kind: 'number',
    unit: 'opsz-px',
    domain: { min: glyphOpszRange.min, max: glyphOpszRange.max },
    default: glyphOpszRange.default,
    semanticEffect: 'Оптический размер, от которого выводятся raster minima.',
  },
  weight: {
    kind: 'number',
    unit: 'normalized-canvas',
    domain: { minExclusive: 0, opticalMinimum: 'minStroke' },
    default: { kind: 'max', value: operatorTokens.shared.weight, opticalMinimum: 'minStroke' },
    semanticEffect: 'Толщина head и shaft при сохранении aperture/ink bounds.',
  },
  clearance: {
    kind: 'number',
    unit: 'normalized-canvas',
    domain: { min: 0, opticalMinimum: 'minClearance' },
    default: { kind: 'opticalMinimum', value: 'minClearance' },
    semanticEffect: 'Минимальная aperture/внутренняя контрформа directional-family.',
  },
  margin: {
    kind: 'number',
    unit: 'normalized-canvas',
    domain: { min: 0 },
    default: operatorTokens.directional.margin,
    semanticEffect: 'Минимальное внешнее поле до canvas; окончательную допустимость размера проверяет geometry owner.',
  },
  headLength: {
    kind: 'number',
    unit: 'normalized-canvas',
    domain: { minExclusive: 0 },
    default: operatorTokens.directional.headLength,
    semanticEffect: 'Продольная длина одной переиспользуемой arrow-head формы.',
  },
  headSpan: {
    kind: 'number',
    unit: 'normalized-canvas',
    domain: { minExclusive: 0 },
    default: operatorTokens.directional.headSpan,
    semanticEffect: 'Поперечное раскрытие arrow-head и её aperture.',
  },
} satisfies Record<string, RecipeParameterContract>);

const recipeDefinitions = {
  'directional-arrow': {
    contract: deepFreeze({
      version: 1,
      parameters: {
        ...directionalParameters,
        shaftLength: {
          kind: 'number',
          unit: 'normalized-canvas',
          domain: { minExclusive: 0 },
          default: operatorTokens.directional.shaftLength,
          semanticEffect: 'Длина shaft; head остаётся той же registered directional-анатомией.',
        },
      },
      outputs: {
        partIds: ['head', 'shaft'],
        anchorIds: ['arrow.tip'],
        negativeSpace: [
          {
            kind: 'aperture',
            measurementMethod: 'polyline-endpoint-distance-minus-stroke',
            participants: ['head.start', 'head.end'],
          },
          {
            kind: 'exterior-margin',
            measurementMethod: 'ink-bounds-to-canvas',
            participants: ['head', 'shaft', 'canvas'],
          },
        ],
      },
    } satisfies RegisteredRecipeContract),
    build: buildDirectionalArrow as unknown as RegisteredRecipeBuilder,
  },
} as const;

export type RegisteredDesignRecipeId = keyof typeof recipeDefinitions;

export const designRecipeRegistryContract: Readonly<
  Record<RegisteredDesignRecipeId, RegisteredRecipeContract>
> = deepFreeze({
  'directional-arrow': recipeDefinitions['directional-arrow'].contract,
});

export function registeredRecipeDefinition(id: RegisteredDesignRecipeId) {
  return recipeDefinitions[id];
}
