/** Общие paint primitives не зависят от каталога, рецептов и motion. */
export interface RecipeStrokePaint {
  readonly kind: 'stroke';
  readonly fill: 'none';
  readonly stroke: 'currentColor';
  readonly strokeWidth: number;
  readonly linecap: 'round' | 'butt';
  readonly linejoin: 'round';
}

export interface RecipeFillPaint {
  readonly kind: 'fill';
  readonly fill: 'currentColor';
}

