# @labpics/icons

Библиотека иконок Labpics. 444 SVG: 222 Filled + 222 Outline.
Статика систематизирована анатомией: токены сетки и весов — в
`semantics/grid.json`, декларации глифов — в `semantics/anatomy.json`,
производные файлы держатся гейтом дрейфа. Подробно: [docs/anatomy.md](docs/anatomy.md), грамматика начертания: [docs/grammar.md](docs/grammar.md).

## Установка

Пакет **приватный** и НЕ публикуется в npm-реестры (в `package.json` стоит
`private: true` — защита от случайного `npm/pnpm publish`). Он ставится как
**git-зависимость** по иммутабельному тегу `<версия>-dist`, внутри которого лежит уже
собранный `dist/`. Поле `files` в `package.json` оставляет в установке ровно
`dist/index.js` + `dist/index.d.ts` (+ `package.json`, `README`) — без исходных SVG.
Сборка на стороне потребителя не нужна.

> Почему не GitHub Packages: реестр требует, чтобы scope пакета совпадал с
> аккаунтом-владельцем, а бренд-scope `@labpics` занят неактивным User-сквоттером.
> Для git-зависимостей имя пакета свободно, поэтому бренд `@labpics/icons`
> сохраняется. Путь через GitHub Packages вернём, если GitHub освободит username
> `labpics`.

**В `package.json` потребителя:**

```json
{
  "dependencies": {
    "@labpics/icons": "github:Labpics-Team/lab-icons#v0.0.1-dist"
  }
}
```

Затем `pnpm install`.

**Аутентификация** (репозиторий приватный, токен только в переменной окружения,
НИКОГДА в git):

- **Локально:** отдельный токен не нужен — работает существующая авторизация
  `gh`/`git` (если `git clone` приватного репозитория проходит, поставится и git-dep).

- **В CI потребителя:** fine-grained PAT со scope `Contents: read` на
  `Labpics-Team/lab-icons`, прокинутый в переменную окружения (напр. `GH_PAT`) и
  подставленный в git через `insteadOf` (в Labpics токен хранится в Infisical как
  SSOT — не хардкодь и не коммить его):

  ```bash
  git config --global url."https://x-access-token:${GH_PAT}@github.com/".insteadOf "ssh://git@github.com/"
  git config --global url."https://x-access-token:${GH_PAT}@github.com/".insteadOf "https://github.com/"
  ```

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

## Nightly quality gates

For an overnight, review-friendly cycle:

```bash
pnpm check:quality-nightly          # non-strict run, writes quality/quality-report-*.json
pnpm check:quality-nightly:strict   # strict run; exit 1 on quality defects from strict checks
```

The command also (re)builds `preview/icon-preview-full.html` with:

- original icon + generated icon,
- per-row deviation,
- and a reason cell for deviations above 3%.
