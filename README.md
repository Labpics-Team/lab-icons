# @labpics/icons

Публичная библиотека иконок Labpics: **222 имени × 2 варианта = 444 SVG** и
ровно 444 именованных ESM-экспорта. Исходная канва — `0 0 24 24`, чернила —
`currentColor`, package surface — без runtime-зависимостей и с
`sideEffects: false`.

Это не обещание, что весь корпус уже параметрический. Авторская геометрия
доступна целиком; генеративная модель включается только для вариантов, которые
прошли quality policy. Остальные честно возвращаются как source IR, без
синтетической «догадки».

## Установка

Primary channel, зафиксированный в [`release/contract.json`](release/contract.json), —
публичный npm:

```bash
pnpm add @labpics/icons
```

Иммутабельный GitHub fallback для версии этого checkout:

```json
{
  "dependencies": {
    "@labpics/icons": "github:Labpics-Team/lab-icons#v0.3.0-dist"
  }
}
```

`-dist` — отдельный артефактный commit поверх source tag `v0.3.0`; его parent,
точный список файлов и blob каждого output проверяются перед созданием либо
повторным использованием тега. Наличие npm‑контракта не подменяет факт
публикации конкретной версии: перед релизным объявлением registry проверяется
отдельно.

## Публичные entrypoints

| Импорт | Назначение |
|---|---|
| `@labpics/icons` | Статические SVG-строки и тип `IconName` |
| `@labpics/icons/ir` | Строгий Glyph IR, каталог, capabilities, оси и calendar recipe |
| `@labpics/icons/ir/recipes` | Лёгкие чистые kernels: стрелки, декораторы, лучи, ноты, календарные цифры |

```ts
import { accessibilityOutline } from '@labpics/icons'
import { glyph, glyphCapabilities } from '@labpics/icons/ir'
import { buildDirectionalArrow } from '@labpics/icons/ir/recipes'

const exactSource = glyph({
  icon: 'accessibility',
  variant: 'outline',
  modelMode: 'source-only',
})

const capabilities = glyphCapabilities('reload', 'outline')
const arrow = buildDirectionalArrow({ orientation: 'forward', shaftLength: 0.52 })

void [accessibilityOutline, exactSource, capabilities, arrow]
```

`glyph()` по умолчанию использует только accepted‑модель и автоматически
возвращает точный source fallback там, где модели нет либо она в quarantine.
`allow-candidate` — явный исследовательский режим, не неявное расширение
production surface. Поддержанные оси узнаются через `glyphCapabilities()`:
наличие `weight`, `corner` или `opsz` не предполагается одинаковым у всех
иконок.

Каждый geometry recipe публикует проверенные контрформы через
`negativeSpace.constraints`: normalized minimum и фактическое измерение с
именованным методом и участниками. Отдельного `pass` нет — нарушение minimum
останавливает построение исключением.

Точность fallback ограничена намеренно закрытым source-языком: монохромные
fill-paths с локальным fill rule. Viewport-identity clip понижается как
доказанный no-op; частичный clip, mask, transform и прочая невыраженная в IR
render-семантика fail-closed, а не теряется при извлечении path.

## Геометрическая система

Канон системы описан в [docs/foundations.md](docs/foundations.md): keylines,
негативное пространство, оптические пределы, stable part identity, topology и
правила композиции. Основные слои:

- `semantics/grid.json` — сетка, веса, поля и допуски;
- `semantics/anatomy.json` — декларации архетипов и переиспользуемых частей;
- `semantics/catalog.json` — закрытый каталог source/model capabilities и
  fingerprints;
- `semantics/model-quality.json` — accepted/quarantine policy;
- `src/ir/` — типизированная публичная граница без часов, DOM и файлового IO;
- `scripts/lib/glyph-operators.js` — чистые геометрические операторы.

Chevron и shaft образуют стрелку через явный weld; enclosure, strike и badge —
переиспользуемые декораторы; `sun-low → sun` строится радиальными слотами;
одиночная и парная ноты используют общую анатомию. Стабильные `part.id`,
`morphGroup`, anchors и composition готовят формы к последующей поиконной
семантической анимации. Эта статика не выдаёт generic scale/rotate за готовый
SF Symbols‑класс motion.

В частности, текущая анатомия `time` — корректный статический socket, но ещё не
контракт независимого вращения стрелок. Motion-capability появится только после
перехода к самостоятельным bearing-overlap capsules и доказанного lowering
через `union`/`mask-subtract` на всём диапазоне поворотов.

`calendarNumberGlyph()` принимает явные `Date`, IANA time zone и `opsz`, а
цифры строит собственным rounded recipe с табличными слотами. Время остаётся
инъекцией вызывающего кода: библиотека не читает «сегодня» скрыто при импорте.

Числовая непрерывность генератора ещё не делает ось публичной capability.
Каждая рекламируемая `weight`/`corner` проходит sampled optical proof из
`semantics/axis-quality.json`; topology drift и фазовая нестабильность остаются
явным debt, пока геометрический закон не исправлен.

## Observatory

```bash
pnpm observatory
```

Команда создаёт локальную `preview/observatory.html` и машинный JSON‑отчёт. На
одной странице показаны original, generated, overlay/diff, отклонение,
topology, ink и объяснение каждого результата выше порога 3%. Страница —
инструмент ревью и диагностики; генерация отчёта сама по себе не переводит
candidate в accepted — SSOT статуса остаётся в quality policy.
Target-size binary deviation пока диагностический, потому что это не
alpha coverage; target topology при этом участвует в acceptance.

## Сборка и доказательства

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm verify
```

`pnpm build` — единственный полный build entrypoint:

1. `build:static` оптимизирует исходные SVG, генерирует root ESM/types и
   анатомический diagnostic output;
2. `build:catalog` пересобирает catalog и TypeScript‑проекцию из актуальной
   геометрии до компиляции публичного IR;
3. `build:ir` собирает `/ir`, `/ir/recipes` и их точную declaration closure во
   временный каталог, проверяет закрытый набор output и транзакционно заменяет
   owned `dist/ir` с восстановлением после ошибки или прерванного swap;
4. lifecycle `prepack` вызывает тот же `pnpm build`.

Публичный tarball содержит ровно 7 release‑файлов из `release/contract.json` плюс npm
metadata. `check:package-artifact` копирует исходники без `dist/`, запускает
реальный `pnpm pack`/`prepack`, ставит tarball в пустого offline‑consumer и
проверяет все ESM entrypoints, bundler/NodeNext TypeScript declarations,
ожидаемо закрытый CommonJS surface, source fingerprints и hostile mutations.
Поэтому старый локальный `dist/` не способен сделать гейт зелёным.

`pnpm verify` также запускает типы, геометрические инварианты, catalog/anatomy
drift, размерные ratchets, docs drift и unit/property bite‑тесты. Числа в этом
README либо выводятся из закрытого файлового контракта, либо защищены гейтом.
Size-ratchet обязан быть точной проекцией всех семи файлов
`release/contract.json`, поэтому новый public output не может остаться без
raw/gzip ceiling.
Исторические отчёты variant parity и path quality не выданы за нулевой долг:
их ceiling и SHA-256 полного множества findings заморожены в
`semantics/legacy-quality-snapshot.json`, поэтому новая регрессия не прячется
за зелёным report-режимом.

## Релиз

Source release запускается только тегом, дословно равным
`v<package.json#version>`:

```bash
git tag v0.3.0
git push origin v0.3.0
```

[`release-dist.yml`](.github/workflows/release-dist.yml) проверяет строгий
SemVer, совпадение checkout HEAD с source tag, выполняет `pnpm verify`, затем
создаёт `v0.3.0-dist`. Ручной запуск принимает только уже существующий source
tag; branch и SHA не являются допустимыми release ref. Существующий sibling не
считается успехом вслепую: его parent, manifest и байты сравниваются с текущей
clean‑сборкой. `master` workflow не изменяет.

## Структура

```text
svg/{Outline,Filled}/       авторские исходники
semantics/                  сетка, анатомия, каталог и quality policy
src/ir/                     Glyph IR и публичные recipe types
scripts/lib/                functional geometry core
release/contract.json       SSOT npm/git-dist package surface
docs/foundations.md         геометрическая конституция
preview/                    локальный ignored Observatory output
```

## Потребители

- `labui` — UI-компоненты и реэкспорт статических иконок;
- `lab-motion` — потребитель стабильной анатомии для будущих смысловых
  choreography/morph‑контрактов.
