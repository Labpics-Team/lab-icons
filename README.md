# @labpics/icons

Библиотека иконок Labpics. 444 SVG: 222 Filled + 222 Outline.

## Структура

```
svg/
  Filled/   — 222 иконки (*_filled.svg)
  Outline/  — 222 иконки (*.svg)
svgo.config.cjs — конфиг оптимизации (currentColor, 24×24 viewBox)
```

## Конвенция имён

| Вариант | Файл                       | Экспорт                |
|---------|----------------------------|------------------------|
| Filled  | `accessibility_filled.svg` | `accessibilityFilled`  |
| Outline | `accessibility.svg`        | `accessibilityOutline` |

## Как собрать

```bash
pnpm install
pnpm build       # svgo-оптимизация + генерация dist/index.js + dist/index.d.ts
```

## Как потреблять

```ts
import { accessibilityFilled, accessibilityOutline } from '@labpics/icons'
```

Только используемые иконки попадают в бандл (tree-shaking через `sideEffects: false`).

## Инварианты

- Нет runtime-зависимостей (`dependencies: {}`)
- Каждый SVG — `currentColor`, `viewBox="0 0 24 24"`
- 222 имён × 2 варианта = 444 экспорта; несоответствие → ненулевой exit билда
