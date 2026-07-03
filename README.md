# @labpics/icons

Библиотека иконок Labpics. 444 SVG: 222 Filled + 222 Outline.
Статика систематизирована анатомией: токены сетки и весов — в
`semantics/grid.json`, декларации глифов — в `semantics/anatomy.json`,
производные файлы держатся гейтом дрейфа. Подробно: [docs/anatomy.md](docs/anatomy.md).

## Структура

```
svg/
  Filled/   — 222 иконки (*_filled.svg)
  Outline/  — 222 иконки (*.svg)
semantics/
  grid.json     — токены системы: веса штрихов, keylines, ζ-профиль скруглений
  anatomy.json  — декларации глифов (архетипы и части-примитивы, доли канвы)
scripts/
  lib/anatomy-gen.js    — генераторы глифов из деклараций
  lib/curve-sampling.js — выборка и геометрия кривых (ядро гейтов)
  check-*.js            — гейты (анатомия, пары O↔F, качество кривых, сетка)
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
- Иконки со статусом `generated` в `semantics/anatomy.json` — производные
  деклараций: гейт `check:anatomy` держит совпадение ≥ 99.5% чернил
- Пары O↔F под контрактом (`check:variant-parity`): каноны весов колец,
  регистрация ≤ 0.15
- Чистота кривых (`check:path-quality`): без волосяных фрагментов,
  лишних узлов, встык-швов между path

## Проверить всё

```bash
pnpm verify   # build + parity + colors + tree-shake + 4 гейта статики + тесты
```
