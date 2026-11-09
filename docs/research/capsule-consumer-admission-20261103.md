# Цена вариации capsule.width после допуска

У реального Lab UI consumer run `41550231826` два неизменённых импорта превышали
потолки: Mic — 28859 / 9270 B, Mic Circle — 25959 / 9673 B raw/gzip.
Source producer — `e3474a3f2a1d39bea683da95e4edb0e2f9f0649e`.
Этот срез устраняет лишнюю работу в capsule runtime, сохраняя авторские формы,
допуск ширины `[0.8, 1]`, IR, provenance и подготовленную анимацию.

## Решение

`glyph.name` сохраняется через стандартный `Object.defineProperty` на обычной
возвращаемой функции. У capsule отключён общий `keepNames`: приватные factory,
класс и helpers не обещаны через package exports. Имена экспортируемых свойств,
`error.name` и `error.code` сохраняются. Настройки Motion остались прежними.

Capsule factory самостоятельно замораживает source tree, включая незамороженных
потомков замороженного родителя. Прежняя дополнительная static factory больше
не создаётся ради разбора некорректного запроса. Обычный parser сохраняет прежние
ошибки для примитивов и массивов, включая массив с собственным `variation`.
Программа ширины готовится в уже существующем проходе допуска вариантов.

У `prepareCapsulePath` ровно два production callers. Static factory уже проверяет
grammar, число точек, rates и конечность координат. Prepared-motion factory теперь
проверяет grammar и число точек в своей существующей границе packet admission.
Общий материализатор получает допущенные operands; повторные проверки и три
дублирующихся сообщения из него удалены. Формула, порядок арифметики, сохранённые
operands и сериализация пути не менялись. На каждом кадре не добавлено parsing,
IR, hash или новая копия геометрической программы.

Три сообщения сокращены; машинные ошибки сохраняются:

| Код | Сообщение после правки |
| --- | --- |
| `VARIATION_SOURCE_MISMATCH` | `Packet capsule.width не принадлежит master.` |
| `AUTHOR_VARIATION_UNSUPPORTED` | `Начертание не поддерживает capsule.width.` |
| `VARIATION_OUTSIDE_DOMAIN` | `bodyWidth вне допущенного диапазона master.` |

## Контрпример и результаты

Простое выключение `keepNames` нарушает `glyph.name`: получена пустая строка.
Это RED в записанном варианте `before-private-minify`. Сохранение всех приватных
имён тоже не проходит consumer ceilings. Concise object method не выбран: он
меняет constructibility. Общий PURE для `Object.defineProperty` и переписывание
esbuild helpers не используются.

Запуск: `node docs/research/capsule-public-name-probe-20261103.mjs` после установки
штатных dependencies. Node `24.15.0`, esbuild `0.28.1`, Windows x64;
fflate gzip level `9`, mtime `0`. Тяжёлые build, browser, pack, benchmarks и полная
Vitest suite локально не выполнялись.

| Полный импорт одной семьи | До: raw/gzip B | После: raw/gzip B | Неизменённый потолок |
| --- | ---: | ---: | ---: |
| `varied-microphone` | 28859 / 9270 | 27018 / 8749 | 27620 / 8783 |
| `varied-microphone-circle` | 25959 / 9673 | 24118 / 9164 | 24720 / 9192 |

Проверка производит только четыре актуальных masters и штатные runtime этих
импортов. До правки она воспроизводит оба удалённых результата. Это source
reproduction, а не приёмка нового tarball или конечного Lab UI runtime.
Байты детерминированы; время, память и frame latency этим запуском не измерялись.

28 поз совпали с неизменяемым runtime `0364b85cb45f18aae4c0596d5ba5633dab25e722`.
Сохранены default identity, дескриптор имени, `.length`, prototype/constructor,
call/apply/construct, заморозка source и отказы axes/domain. Восемь повреждений
grammar/controls/counts/rates отвергнуты после повторного расчёта хешей: oracle
проверяет shape admission, а не только checksum mismatch. 20 соседних допустимых
ширин совпали между static и prepared физическим путём. Отдельно собраны реальные
prepared и capabilities imports: prepared не удерживает IR/capability geometry,
capabilities не удерживает body path; static variation не импортирует motion factory.

Полные записи, SHA-256 и graphs —
[capsule-public-name-probe-20261103.json](capsule-public-name-probe-20261103.json).
Регрессии — `test/runtime-name-contract.test.js` и
`test/capsule-packet-admission.test.js`. Узкая strict TypeScript проверка трёх
изменённых runtime пройдена с TypeScript `7.0.2` и `--ignoreConfig`.
Итоговые удалённые package/consumer/visual gates остаются обязательными.

## Первичные источники

- [esbuild Keep names](https://esbuild.github.io/api/#keep-names): minification
  меняет `.name`; штатный глобальный режим сохраняет все имена.
- [ECMA-262 2026, SetFunctionName 10.2.9](https://tc39.es/ecma262/2026/#sec-setfunctionname):
  дескриптор `name` — non-writable, non-enumerable, configurable.
- [MDN Function.name](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/name):
  изменение имени через `Object.defineProperty`.

Источники прочитаны 2026-11-03. Локальное имя закрепляет контракт на границе API;
допуск до материализации убирает повторную работу для последующих capsule families.
