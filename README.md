# @labpics/icons

Библиотека иконок Labpics: **222 имени × 2 варианта (Outline + Filled) = 444 SVG**,
ровно 444 именованных ESM-экспорта (+ union-тип `IconName`) и рантайм
«анимаций от смысла» в подпути `@labpics/icons/animate`. Без runtime-зависимостей,
tree-shakeable (`sideEffects: false`), каждая иконка — `currentColor` на канве
`viewBox="0 0 24 24"`.

Три вещи, которые нужно знать сразу:

1. **Пакет не публикуется в npm-реестры.** Он ставится как git-зависимость по
   иммутабельному тегу `vX.Y.Z-dist` — см. [Установка](#установка).
2. **`dist/` в git не хранится** (gitignored). Он собирается заново на каждом
   релизе и живёт только внутри `-dist` тега — см. [Релиз](#релиз-как-рождается--dist-тег).
3. **И статика, и моушн описаны декларациями** (`semantics/`), а расхождение
   производных файлов с декларациями ловят **22 гейта** —
   см. [Гейты](#разработка-сборка-и-гейты).

## Как устроен конвейер

```mermaid
%%{init: {'theme':'base','themeVariables':{
  'lineColor':'#787880','textColor':'#0A0A10',
  'edgeLabelBackground':'#F7F7FF',
  'clusterBkg':'transparent','clusterBorder':'#787880'
}}}%%
flowchart LR
  subgraph src["Исходники (коммитятся в git)"]
    SVG["svg/Outline + svg/Filled<br/>222 + 222 SVG"]:::node
    SEM["semantics/<br/>grid · anatomy · assignments · layers"]:::node
    ANI["src/animate/<br/>index.ts + генерат хореографий"]:::node
  end
  subgraph bld["pnpm build + build:animate"]
    B1["scripts/build.js<br/>SVGO: #101012 → currentColor"]:::accent
    B2["scripts/build-anatomy.js<br/>скелет из path-данных"]:::node
    B3["tsup<br/>ESM + CJS + d.ts"]:::node
  end
  subgraph dst["dist/ (в git НЕ хранится)"]
    IDX["index.js + index.d.ts<br/>444 экспорта + тип IconName"]:::dark
    DSVG["svg/<br/>оптимизированные копии"]:::node
    ANAT["anatomy.json"]:::node
    DANI["animate/"]:::node
  end
  VER["pnpm verify<br/>22 гейта + vitest"]:::accent
  SVG --> B1
  B1 --> IDX
  B1 --> DSVG
  DSVG --> B2
  B2 --> ANAT
  ANI --> B3
  B3 --> DANI
  SEM -. "декларации и токены" .-> VER
  IDX --> VER
  ANAT --> VER
  DANI --> VER
  classDef node fill:#F7F7FF,stroke:#787880,color:#0A0A10
  classDef accent fill:#006FF3,stroke:#787880,color:#FCFDFF
  classDef dark fill:#101012,stroke:#787880,color:#F2F2FC
  style src fill:transparent,stroke:#787880,color:#787880
  style bld fill:transparent,stroke:#787880,color:#787880
  style dst fill:transparent,stroke:#787880,color:#787880
```

Рукой рисуются только SVG в `svg/` (моно-чернила `#101012`). `pnpm build`
прогоняет их через SVGO (чернила → `currentColor`), генерирует
`dist/index.js` + `dist/index.d.ts` и строит `dist/anatomy.json` — скелет
глифов из path-данных. `pnpm build:animate` (tsup) собирает рантайм анимаций
в `dist/animate` (ESM + CJS + `d.ts`). Всё, что в `dist/`, — производное
и воспроизводимое.

## Установка

Пакет ставится **git-зависимостью** по тегу `<версия>-dist`, внутри которого
уже лежит собранный `dist/`. Сборка на стороне потребителя не нужна.

**В `package.json` потребителя:**

```json
{
  "dependencies": {
    "@labpics/icons": "github:Labpics-Team/lab-icons#v0.2.0-dist"
  }
}
```

Затем `pnpm install`.

> **Что внутри `-dist` тега:** релизный workflow
> ([`release-dist.yml`](.github/workflows/release-dist.yml)) коммитит в него
> ровно то, что перечислено в поле `files` `package.json`:
> `dist/index.js` + `dist/index.d.ts` + `dist/animate` (рантайм `./animate`:
> ESM + CJS + типы). Исключение — уже опубликованный `v0.2.0-dist`: он собран
> до этого фикса и `dist/animate` **не** содержит (артефакт иммутабелен,
> задним числом не патчится). Подпуть `./animate` придёт в git-dep со
> следующим релизным тегом.

> **Почему не npm/GitHub Packages:** реестр требует, чтобы scope пакета совпадал
> с аккаунтом-владельцем, а бренд-scope `@labpics` занят неактивным
> User-сквоттером. Для git-зависимостей имя пакета свободно, поэтому бренд
> `@labpics/icons` сохраняется. Путь через GitHub Packages вернём, если GitHub
> освободит username `labpics`.

**Аутентификация** (репозиторий приватный; токен только в переменной окружения,
НИКОГДА в git):

- **Локально:** отдельный токен не нужен — работает существующая авторизация
  `gh`/`git` (если `git clone` приватного репозитория проходит, поставится и git-dep).
- **В CI потребителя:** fine-grained PAT со scope `Contents: read` на
  `Labpics-Team/lab-icons`, прокинутый в переменную окружения (напр. `GH_PAT`)
  и подставленный в git через `insteadOf` (в Labpics токен хранится в Infisical
  как SSOT — не хардкодь и не коммить его):

  ```bash
  git config --global url."https://x-access-token:${GH_PAT}@github.com/".insteadOf "ssh://git@github.com/"
  git config --global url."https://x-access-token:${GH_PAT}@github.com/".insteadOf "https://github.com/"
  ```

## Использование

```ts
import { accessibilityFilled, accessibilityOutline } from '@labpics/icons'
```

В бандл попадают только импортированные иконки (tree-shaking через
`sideEffects: false`; гейт `check:treeshake` это доказывает на каждом прогоне).

**Конвенция имён** — экспорт выводится из имени файла:

| Вариант | Файл                       | Экспорт                |
|---------|----------------------------|------------------------|
| Filled  | `accessibility_filled.svg` | `accessibilityFilled`  |
| Outline | `accessibility.svg`        | `accessibilityOutline` |

Union-тип всех 444 имён — `IconName` (генерируется в `dist/index.d.ts`).

### Анимации от смысла: `@labpics/icons/animate`

Каждому из 222 имён назначен семантический класс
(`semantics/assignments.json`; закрытый перечень из 13 классов в
`semantics/semantics.json`: direction, spin, bell, wave, sparkle, pulse,
draw, pop, blink, drift, shake, toggle, generic). Класс говорит, **что**
означает иконка; прекомпилированные хореографии (генерат из
`@labpics/motion/presets`) — **как** это движется; рантайм резолвит слои
по per-icon разметке и запускает нативные WAAPI-анимации.

```ts
import { animateIcon } from '@labpics/icons/animate'

// svg — отрендеренный <svg> этой иконки в DOM
const handle = animateIcon(svg, { name: 'notifications', variant: 'outline' })
await handle.finished  // либо handle.cancel() / handle.pause() / handle.play()
```

- **Ноль runtime-зависимостей:** хореографии прекомпилированы, WAAPI нативный.
- **`prefers-reduced-motion`:** анимации не создаются, хендл честно сообщает
  `reduced: true` (статичная иконка — валидная нейтральная поза).
- **SSR-safe:** модуль не трогает DOM/`window` на верхнем уровне.
- **`iterations`:** `1` — разовый смысловой акцент (по умолчанию),
  `Infinity` — ambient-луп.

Вспомогательные функции: `animatableNames()` — имена с готовой анимацией,
`iconClass(name)` — семантический класс имени.

## Релиз: как рождается `-dist` тег

```mermaid
%%{init: {'theme':'base','themeVariables':{
  'lineColor':'#787880','textColor':'#0A0A10',
  'edgeLabelBackground':'#F7F7FF',
  'clusterBkg':'transparent','clusterBorder':'#787880'
}}}%%
flowchart LR
  TAG["git tag vX.Y.Z на master<br/>+ push origin"]:::node
  WF["GitHub Actions<br/>release-dist.yml"]:::accent
  VG["pnpm verify<br/>полный гейт на теге"]:::node
  DT["брат-тег vX.Y.Z-dist:<br/>коммит с dist/index.js + index.d.ts + animate/<br/>поверх релизного тега"]:::dark
  CON["потребитель:<br/>github:Labpics-Team/lab-icons#vX.Y.Z-dist"]:::node
  TAG --> WF
  WF --> VG
  VG -- "зелёный" --> DT
  DT -- "иммутабельный git-dep" --> CON
  classDef node fill:#F7F7FF,stroke:#787880,color:#0A0A10
  classDef accent fill:#006FF3,stroke:#787880,color:#FCFDFF
  classDef dark fill:#101012,stroke:#787880,color:#F2F2FC
```

1. Владелец ставит релизный тег на master: `git tag v0.2.0 && git push origin v0.2.0`.
2. Workflow [`release-dist.yml`](.github/workflows/release-dist.yml) ловит push
   тега `v*` (собственные `-dist` теги исключены из триггера), гоняет полный
   `pnpm verify` и коммитит содержимое поля `files`: `dist/index.js`,
   `dist/index.d.ts`, `dist/animate` (принудительный `git add -f` — `dist/`
   в `.gitignore`) поверх релизного тега.
3. Этот коммит пушится **только как тег `vX.Y.Z-dist`** — master не меняется.
4. Артефакт иммутабелен: существующий `-dist` тег workflow не перезаписывает.
   Новый релиз = новый тег.

## Структура репозитория

```
svg/
  Filled/          — 222 иконки (*_filled.svg), моно-чернила #101012
  Outline/         — 222 иконки (*.svg)
semantics/
  grid.json        — токены сетки (v2): веса штрихов, keylines, допуски, кламп оси weight
  anatomy.json     — генеративные декларации 63 глифов (архетипы, части-примитивы)
  semantics.json   — закрытый перечень 13 анимационных классов и направлений
  assignments.json — семантический класс каждого из 222 имён
  layers.json      — per-icon разметка слоёв (path-индексы, якоря)
  flagships.json   — манифест флагманов для check:dry-coverage
  adjacency-promoted.json, ink-weight-promoted.json — allowlist'ы HARD-промоушена гейтов
anatomy/
  bindings.json    — семантические привязки анимаций к анатомии (жест, ось, pivot, $why)
src/animate/
  index.ts         — рантайм ./animate (WAAPI)
  *.generated.json — прекомпилированный генерат хореографий (гейтится)
scripts/
  build.js            — SVGO + генерация dist/index.js и dist/index.d.ts
  build-anatomy.js    — dist/anatomy.json из path-данных dist/svg
  gen-choreographies.mjs — генерация хореографий из пресетов lab-motion
  lib/                — генераторы глифов, геометрия кривых, motion-scan (ядро гейтов)
  geometry/, migrate/ — инструментарий фитов и миграций корпуса (не гейты)
  check-*.js          — 22 гейта (см. таблицу ниже)
test/              — vitest-сьюты: анатомия, примитивы, гейты, геометрия
docs/
  anatomy.md · anatomy-model.md · grammar.md
svgo.config.cjs    — конфиг оптимизации (currentColor, 24×24 viewBox)
tsup.config.ts     — сборка подпути ./animate
.github/workflows/ — ci.yml (гейты на PR/push), release-dist.yml (релиз)
```

## Разработка: сборка и гейты

```bash
pnpm install
pnpm build          # svgo-оптимизация + dist/index.js|d.ts + dist/anatomy.json
pnpm build:animate  # tsup → dist/animate (ESM + CJS + d.ts)
pnpm verify         # сборка + tsc --noEmit + 22 гейта + vitest — полный локальный гейт
```

CI ([`ci.yml`](.github/workflows/ci.yml), pnpm 9 / Node 20) гоняет ровно те же
гейты, что и `pnpm verify`, отдельными шагами (паритет CI ↔ verify закреплён
в #56) и добавляет шесть **bite-тестов**: в исходники подсовывается поломка,
и гейт обязан упасть.

Каждый гейт запускается и отдельно: `pnpm check:<имя>`.

| Гейт | Что ловит | Политика |
|---|---|---|
| `check:parity` | 222 + 222 файла, ровно 444 экспорта в `dist/index.js` | HARD |
| `check:colors` | хардкод-hex в оптимизированных SVG (всё должно быть `currentColor`) | HARD |
| `check:treeshake` | пруф tree-shaking: неиспользуемые экспорты выпадают из бандла | HARD |
| `check:semantics` | каждое имя покрыто валидной семантикой: класс из перечня, `params.dir`, якоря в viewBox | HARD |
| `check:choreographies` | генерат хореографий: провенанс `motionSha`, полнота классы↔хореографии в обе стороны | HARD |
| `check:layers` | per-icon разметка ↔ реальные SVG и генерат: path-индексы существуют, якоря в границах | HARD |
| `check:motion-bounds` | ни один кадр анимации не выводит контур слоя за канву | HARD |
| `check:motion-collision` | движение не создаёт новых наслоений слоёв | HARD |
| `check:variant-parity` | контракт пары O↔F: каноны весов колец, регистрация глифа ≤ 0.15 px | HARD |
| `check:anatomy` | скелет всех 444, байт-детерминизм `anatomy.json`, валидность привязок | HARD |
| `check:anatomy:drift` | дрейф файла от декларации: `generated` IoU ≥ 99.5% | HARD (`hand` ≥ 95% — report) |
| `check:path-quality` | шум кривых, волосяные фрагменты, встык-швы между path | report (`--strict` валит) |
| `check:static-grid` | канва, поля и keylines по токенам `grid.json` | канва HARD, поля report |
| `check:fill-rule` | «блоб» — контур залился из-за fill-rule | Outline HARD, Filled WARN |
| `check:topology` | незамкнутый контур — срез хордой | Outline HARD, Filled WARN |
| `check:corners` | пер-вершинные скругления генерат-vs-рука | WARN-каталог (HARD после EC3) |
| `check:adjacency` | части, смыкающиеся в руке, разорваны в генерате | WARN-каталог + HARD для promoted |
| `check:ink-weight` | фактическая толщина чернил = канон лестницы; `--axes` — кламп оси weight | report + HARD для promoted |
| `check:grammar` | направления прямых рёбер на шкале углов | report (`--strict` валит) |
| `check:fidelity` | пол узнаваемости generated-глифов: ≥ 97% на обоих вариантах | HARD ниже пола без `ownerReview` |
| `check:dry-coverage` | флагманы на 100% из общих примитивов, каждый примитив ≥ 2 потребителя | HARD по флагманам |
| `check:anim-ready` | подвижные части не «сварены» в один суб-путь, оси вращения заданы | HARD (+ report-слой миграции) |

Разница политик Outline/Filled сознательная: у контурных иконок блоб или срез —
видимая поломка (HARD), у заливок сплошная заливка и незамкнутые
конструкционные слои бывают по замыслу (WARN).

## Анатомическая модель

Иконки описаны не только пикселями, но и декларациями: `semantics/grid.json`
задаёт токены (веса штрихов, keylines, допуски, кламп оси веса),
`semantics/anatomy.json` — архетипы и части-примитивы 63 глифов. Иконки со
статусом `generated` обязаны совпадать со своей декларацией на ≥ 99.5% чернил
(IoU), падение узнаваемости ниже 97% — стоп-сигнал. Подробно:
[docs/anatomy.md](docs/anatomy.md) (обзор),
[docs/anatomy-model.md](docs/anatomy-model.md) (модель),
[docs/grammar.md](docs/grammar.md) (грамматика начертания).

## Потребители

- **labui** — реэкспортирует иконки в `packages/icons` (компонент `<lab-icon>`).
- **lab-motion** — источник прекомпилированных хореографий
  (`@labpics/motion/presets`) и читатель `anatomy/bindings.json`:
  семантические привязки анимаций (жест, pivot, ось) к анатомии глифов.
