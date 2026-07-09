# @labpics/icons

Библиотека иконок Labpics: **222 имени × 2 варианта (Outline + Filled) = 444 SVG**
и ровно 444 именованных ESM-экспорта (+ тип `IconName`). Без runtime-зависимостей
(`dependencies: {}`), tree-shakeable (`sideEffects: false`), каждая иконка —
`currentColor` на канве `viewBox="0 0 24 24"`.

Три вещи, которые нужно знать сразу:

1. **Пакет НЕ публикуется в npm-реестры** (`private: true`). Он ставится как
   git-зависимость по иммутабельному тегу `vX.Y.Z-dist` — см. [Установка](#установка).
2. **`dist/` в git не хранится** (gitignored). Он собирается заново на каждом
   релизе и живёт только внутри `-dist` тега — см. [Релиз](#релиз-как-рождается--dist-тег).
3. **Статика систематизирована анатомической моделью**: токены сетки и декларации
   глифов лежат в `semantics/`, а расхождение производных файлов с декларациями
   ловят гейты — см. [Гейты](#разработка-сборка-и-гейты).

## Как устроен конвейер

```mermaid
%%{init: {'theme':'base','themeVariables':{
  'lineColor':'#787880','textColor':'#0A0A10',
  'edgeLabelBackground':'#F7F7FF',
  'clusterBkg':'transparent','clusterBorder':'#787880'
}}}%%
flowchart LR
  subgraph src["Исходники (коммитятся в git)"]
    OUT["svg/Outline<br/>222 SVG"]:::node
    FIL["svg/Filled<br/>222 SVG"]:::node
    SEM["semantics/<br/>grid · anatomy · flagships"]:::node
  end
  subgraph bld["pnpm build"]
    B1["scripts/build.js<br/>SVGO: #101012 → currentColor"]:::accent
    B2["scripts/build-anatomy.js<br/>скелет из path-данных"]:::node
  end
  subgraph dst["dist/ (в git НЕ хранится)"]
    IDX["index.js + index.d.ts<br/>444 экспорта + тип IconName"]:::dark
    DSVG["svg/<br/>оптимизированные копии"]:::node
    ANAT["anatomy.json"]:::node
  end
  VER["pnpm verify<br/>13 гейтов + vitest"]:::accent
  OUT --> B1
  FIL --> B1
  B1 --> IDX
  B1 --> DSVG
  DSVG --> B2
  B2 --> ANAT
  SEM -. "декларации и токены" .-> VER
  IDX --> VER
  ANAT --> VER
  classDef node fill:#F7F7FF,stroke:#787880,color:#0A0A10
  classDef accent fill:#006FF3,stroke:#787880,color:#FCFDFF
  classDef dark fill:#101012,stroke:#787880,color:#F2F2FC
  style src fill:transparent,stroke:#787880,color:#787880
  style bld fill:transparent,stroke:#787880,color:#787880
  style dst fill:transparent,stroke:#787880,color:#787880
```

Рукой рисуются только SVG в `svg/` (чернила без hex (наследуются от контекста)). `pnpm build`
прогоняет их через SVGO (чернила → `currentColor`), генерирует
`dist/index.js` + `dist/index.d.ts` и строит `dist/anatomy.json` — скелет
глифов из path-данных. Всё, что в `dist/`, — производное и воспроизводимое.

## Установка

Пакет ставится **git-зависимостью** по тегу `<версия>-dist`, внутри которого
уже лежит собранный `dist/`. Поле `files` в `package.json` оставляет в
установке ровно `dist/index.js` + `dist/index.d.ts` (+ `package.json`,
`README`) — без исходных SVG. Сборка на стороне потребителя не нужна.

**В `package.json` потребителя:**

```json
{
  "dependencies": {
    "@labpics/icons": "github:Labpics-Team/lab-icons#v0.2.0-dist"
  }
}
```

Затем `pnpm install`.

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
  DT["брат-тег vX.Y.Z-dist:<br/>коммит с dist/index.js + index.d.ts<br/>поверх релизного тега"]:::dark
  CON["потребитель:<br/>github:Labpics-Team/lab-icons#vX.Y.Z-dist"]:::node
  TAG --> WF
  WF --> VG
  VG -- "зелёный" --> DT
  DT -- "иммутабельный git-dep" --> CON
  classDef node fill:#F7F7FF,stroke:#787880,color:#0A0A10
  classDef accent fill:#006FF3,stroke:#787880,color:#FCFDFF
  classDef dark fill:#101012,stroke:#787880,color:#F2F2FC
```

1. Владелец ставит релизный тег на master: `git tag vX.Y.Z && git push origin vX.Y.Z` (конкретные версии в доке сверяет check:docs-drift).
2. Workflow [`release-dist.yml`](.github/workflows/release-dist.yml) ловит push
   тега `v*` (собственные `-dist` теги исключены из триггера), гоняет полный
   `pnpm verify` и коммитит `dist/index.js` + `dist/index.d.ts`
   (принудительный `git add -f` — `dist/` в `.gitignore`) поверх релизного тега.
3. Этот коммит пушится **только как тег `vX.Y.Z-dist`** — master не меняется.
4. Артефакт иммутабелен: существующий `-dist` тег workflow не перезаписывает.
   Новый релиз = новый тег.

## Структура репозитория

```
svg/
  Filled/          — 222 иконки (*_filled.svg), цветовых атрибутов нет — чернила наследуются от контекста (hex в dist запрещает check:colors)
  Outline/         — 222 иконки (*.svg)
semantics/
  grid.json        — токены системы: веса штрихов, keylines, допуски
  anatomy.json     — декларации глифов (архетипы и части-примитивы, доли канвы)
  flagships.json   — манифест флагманов для check:dry-coverage
anatomy/
  bindings.json    — семантические привязки анимаций к анатомии (pivot/axis)
scripts/
  build.js            — SVGO + генерация dist/index.js и dist/index.d.ts
  build-anatomy.js    — dist/anatomy.json из path-данных dist/svg
  lib/anatomy-gen.js  — генераторы глифов из деклараций
  lib/curve-sampling.js — выборка и геометрия кривых (ядро гейтов)
  check-*.js          — гейты (см. таблицу ниже)
docs/
  anatomy.md · anatomy-model.md · grammar.md
svgo.config.cjs    — конфиг оптимизации (currentColor, 24×24 viewBox)
.github/workflows/ — ci.yml (гейты на PR/push), release-dist.yml (релиз)
```

## Разработка: сборка и гейты

```bash
pnpm install
pnpm build    # svgo-оптимизация + dist/index.js + dist/index.d.ts + dist/anatomy.json
pnpm verify   # build + 13 гейтов + vitest — то же, что гоняет CI
```

Каждый гейт запускается и отдельно: `pnpm check:<имя>`.

| Гейт | Что ловит | Политика |
|---|---|---|
| `check:parity` | 222 + 222 файла, ровно 444 экспорта в `dist/index.js` | HARD |
| `check:colors` | хардкод-hex в оптимизированных SVG (всё должно быть `currentColor`) | HARD |
| `check:treeshake` | пруф tree-shaking: неиспользуемые экспорты выпадают из бандла | HARD |
| `check:variant-parity` | контракт пары O↔F: каноны весов колец, регистрация глифа ≤ 0.15 px | HARD |
| `check:anatomy` | скелет + привязки `bindings.json`; дрейф: `generated` IoU ≥ 99.5% | HARD (`hand` ≥ 95% — report) |
| `check:path-quality` | шум кривых, волосяные фрагменты, встык-швы между path | HARD |
| `check:static-grid` | поля и keylines по токенам `grid.json` | HARD |
| `check:fill-rule` | «блоб» — контур залился из-за fill-rule | Outline HARD, Filled WARN |
| `check:topology` | незамкнутый контур — срез хордой | Outline HARD, Filled WARN |
| `check:corners` | пер-вершинные скругления генерат-vs-рука | WARN-каталог (HARD после EC3) |
| `check:grammar` | направления рёбер на шкале начертания | HARD |
| `check:fidelity` | пол узнаваемости generated-глифов: ≥ 97% на обоих вариантах | HARD ниже пола без `ownerReview` |
| `check:dry-coverage` | флагманы на 100% из общих примитивов, каждый примитив ≥ 2 потребителя | HARD по флагманам |

Разница политик Outline/Filled сознательная: у контурных иконок блоб или срез —
видимая поломка (HARD), у заливок сплошная заливка и незамкнутые
конструкционные слои бывают по замыслу (WARN).

## Анатомическая модель

Иконки описаны не только пикселями, но и декларациями: `semantics/grid.json`
задаёт токены (веса штрихов, keylines, допуски), `semantics/anatomy.json` —
архетипы и части-примитивы каждого глифа. Иконки со статусом `generated`
обязаны совпадать со своей декларацией на ≥ 99.5% чернил (IoU), падение
узнаваемости ниже 97% — стоп-сигнал. Подробно:
[docs/anatomy.md](docs/anatomy.md) (обзор),
[docs/anatomy-model.md](docs/anatomy-model.md) (модель),
[docs/grammar.md](docs/grammar.md) (грамматика начертания).

## Потребители

- **labui** — реэкспортирует иконки в `packages/icons` (компонент `<lab-icon>`).
- **lab-motion** — читает `anatomy/bindings.json`: семантические привязки
  анимаций (жест, pivot, ось) к анатомии глифов.
