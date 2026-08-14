# `@labpics/icons`

Геометрическое ядро иконок Labpics: **222 семантических имени × Outline/Filled =
444 SVG**. Каждый экспорт — готовая inline-SVG строка на канве `0 0 24 24` с
`currentColor`. Пакет не имеет runtime-зависимостей и поддерживает tree-shaking.

## Быстрый старт

**Основной канал — npm:**

```bash
pnpm add @labpics/icons
```

```ts
import { accessibilityFilled, accessibilityOutline } from '@labpics/icons'

button.innerHTML = accessibilityOutline
```

SVG наследует цвет от CSS:

```css
button {
  color: var(--lab-content-primary);
}
```

Публичный root entrypoint содержит ровно 444 именованных экспорта. Имя строится
механически из canonical kebab-ID:

| Вариант | Исходный файл | Экспорт |
| --- | --- | --- |
| Outline | `svg/Outline/alert-circle.svg` | `alertCircleOutline` |
| Filled | `svg/Filled/alert-circle_filled.svg` | `alertCircleFilled` |

`IconName` — union имён этих экспортов. Canonical ID и правила преобразования
зафиксированы в [`NAMING.md`](NAMING.md).

## Каналы поставки

Машиночитаемый источник истины — [`release/contract.json`](release/contract.json).

1. **npm — основной канал потребления.** Обычная установка не требует GitHub
   credentials и получает root ESM/types и подпуть `@labpics/icons/animate`.
2. **Дополнительный fallback — immutable git `-dist` tag:**
   `github:Labpics-Team/lab-icons#vX.Y.Z-dist`. Он нужен для воспроизводимого
   pin на Git commit и не заменяет npm.

Пример fallback-зависимости:

```json
{
  "dependencies": {
    "@labpics/icons": "github:Labpics-Team/lab-icons#vX.Y.Z-dist"
  }
}
```

Оба канала обязаны нести один contract артефакта:

```text
dist/index.js
dist/index.d.ts
dist/animate/
```

`pnpm verify` собирает package, создаёт настоящий tarball, устанавливает его в
изолированный offline-consumer и проверяет root ESM, `./animate` ESM/CJS, типы и
отсутствие внутренних исходников. Поэтому корректность исходного дерева не
подменяет корректность того, что действительно получает потребитель.

## Архитектура

```text
svg/Outline/                 222 исходных Outline SVG
svg/Filled/                  222 исходных Filled SVG
semantics/grid.json          относительные токены сетки, весов и допусков
semantics/anatomy.json       конструктивные декларации мигрированных глифов
semantics/assignments.json   semantic ID → класс движения
semantics/layers.json        экспериментальная разметка motion-слоёв
scripts/lib/                 геометрическое ядро и общие измерители
scripts/check-*.js           biting quality gates
src/animate/                 экспериментальный runtime смыслового движения
dist/                        воспроизводимый build output, в master не хранится
```

Статический pipeline:

```text
SVG + geometry declarations
        ↓
scripts/build.js + scripts/build-anatomy.js + tsup
        ↓
dist/index.js + dist/index.d.ts + dist/animate + dist/anatomy.json
        ↓
pnpm verify
```

`dist/` — производный артефакт. Он не редактируется и не коммитится в `master`.
Generated SVG также не правится руками: источник изменения — конструктивная
декларация, токен или общий геометрический оператор.

## Геометрический контракт

- Канва — `24 × 24` design units; дробная координата допустима только как вывод
  конструкции, а не как случайный остаток ручного редактирования.
- Outline/Filled используют независимые канонические веса из
  `semantics/grid.json`.
- Негативное пространство гейтится так же строго, как чернила.
- Топология важнее площадного сходства: разрыв, слипание или исчезнувший counter
  являются HARD-дефектом независимо от высокого IoU.
- Разные SVG `<path>` сохраняют собственный `fill-rule` и композитятся как
  отдельные элементы; их `d` нельзя склеивать для рендер-вердикта.
- Конструктивные оси обязаны сохранять ограничения на всём проверяемом
  пространстве значений, а не только в default-точке.

## Анатомическая модель

Иконка рассматривается как знак из именованных конструктивных частей, а SVG —
как одна из его проекций. Корпус систематизируется по семействам:

- `semantics/anatomy.json` описывает архетипы, примитивы, параметры и статус
  `hand/generated`;
- `scripts/lib/anatomy-gen.js` строит геометрию;
- drift/fidelity/topology/weight/adjacency gates проверяют материализованный
  результат;
- сравнение с исходным намерением использует immutable hand baseline с
  provenance, а preview является представлением машинного quality-report.

Подробности:

- [`docs/anatomy.md`](docs/anatomy.md) — обзор;
- [`docs/anatomy-model.md`](docs/anatomy-model.md) — архитектурное решение;
- [`docs/grammar.md`](docs/grammar.md) — грамматика начертания.

Подпуть `@labpics/icons/animate` доступен в артефакте, но имеет
**экспериментальный** статус. Этот статус снимается только после появления
устойчивых `part.id` в Glyph IR и доказанной совместимости геометрических
мастеров. Расширение анимаций не должно диктовать структуру статики.

## Разработка

Требования:

- Node.js `>=20`;
- pnpm `10.30.3` через Corepack.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` — единственный канонический список сборки, typecheck, package smoke,
геометрических гейтов и тестов. CI и release workflow вызывают именно его, а не
копируют команды вручную. Отдельные гейты доступны как `pnpm check:<имя>`.

Ключевые классы проверок:

| Класс | Что защищает |
| --- | --- |
| Repository/package contract | один lockfile, закреплённый toolchain, реальный tarball |
| Corpus parity | 222 пары и 444 экспорта |
| Paint/render | `currentColor`, fill-rule, topology, path quality |
| Geometry | grid, corners, adjacency, ink weight, negative clearance |
| Anatomy | декларация ↔ generated SVG, fidelity и DRY reuse |
| Motion foundation | semantics, layers, bounds, collisions, anim-ready |
| Documentation | версии, счётчики и release contract без дрейфа |

Bite-tests намеренно портят semantics, corpus parity, paint, layer indices и
motion bounds/collisions. Гейт, который не падает на своей отрицательной
фикстуре, не считается защитой.

## Release

Публичная версия считается пригодной к потреблению только после зелёного
`pnpm verify` и проверки опубликованного npm tarball как внешнего consumer.
Операционные credentials не хранятся в git.

Git fallback производится отдельно workflow
[`.github/workflows/release-dist.yml`](.github/workflows/release-dist.yml):

1. на `master` ставится релизный тег `vX.Y.Z`;
2. workflow повторно выполняет `pnpm verify`;
3. поверх тега создаётся новый commit только с файлами из release contract;
4. commit публикуется как immutable `vX.Y.Z-dist`, не изменяя `master`.

Существующий `-dist` tag не перезаписывается. Исправление артефакта требует новой
версии.

## Интеграция с LabUI

`@labpics/icons` — внешнее ядро LabUI. LabUI потребляет пакет через публичный
contract и не копирует SVG или сборочный pipeline. Интеграционный шов обязан
проверяться fixtures для SSR, hydration, accessibility и tree-shaking; временный
workspace-стаб не является альтернативной реализацией ядра.

## Лицензия

MIT.
