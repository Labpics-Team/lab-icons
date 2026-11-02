# Общий контракт типов символа

Проверено 2026-11-02 относительно Icons
`700f863f7cef3d7d17b3eadf29df699cdf144d4c`. Generated declarations повторяли
сигнатуры каждого callable export, а variation добавляла второй набор imports
и overload. Изменение контракта требовало менять шаблон этих копий.

`AuthorSymbolApi` теперь владеет общим контрактом `glyph`/`glyphCapabilities`.
`AuthorVariationSymbolApi` расширяет его в существующем владельце variation.
Символьный declaration связывает этот API только со своим authored ID.
Обычная ветвь не импортирует variation; дополнительного runtime, registry или
entrypoint нет. Сам runtime и исходная геометрия не менялись.

Штатные [call signatures TypeScript](https://www.typescriptlang.org/docs/handbook/2/functions.html#call-signatures)
позволяют описать callable значение без повторения function declarations.
[Правило вывода из последней перегрузки](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types)
требует сохранить порядок overloads. Поэтому единая условная сигнатура здесь
не выбрана: она могла бы изменить точный default или `Parameters`/`ReturnType`
в существующем потребителе. Оставить generated копии — простая альтернатива,
но она сохраняет повторяемые shipping bytes и несколько мест правки API.
Документы прочитаны 2026-11-02; это основание типов, не обещание скорости.

Фактический generated consumer проходит Bundler и NodeNext. Default и явный
source request имеют `source` provenance, variation допускается только в
соответствующем символе; literal icon ID и variation capability сохраняются.
Отрицательный consumer получает ошибки ложной exact-source гарантии,
неподдержанной variation и необоснованного обязательного capability.
Проверка только строки declaration этого свойства не удостоверяет.

[Исходное сравнение](declaration-sharing-20261102.json) и
[воспроизводимый source probe](../../scripts/bench/declaration-sharing.mjs)
измеряют сгенерированные declarations и отдельную узкую declaration-сборку.
Windows, Node v24.15.0, pinned TypeScript native preview, fflate 0.8.3
level 9/mtime 0 и Brotli 1.2.0 quality 11. Это детерминированные размеры,
без timing, полного build/pack и установки опубликованного пакета.

| Declaration | Прежний raw/gzip | Новый raw/gzip |
|---|---:|---:|
| time | 440 / 215 | 282 / 164 |
| ellipsis-horizontal | 718 / 257 | 320 / 182 |
| ellipsis-vertical | 712 / 257 | 318 / 180 |

Суммарный raw только символьных declarations — 149610 → 95064 bytes.
Стоимость общего `author-symbol.d.ts` — 604/337 raw/gzip; расширенный
`authored-variation.d.ts` — 3751/1231. Эти дополнительные dependencies
учитываются отдельно; сумма gzip самостоятельных модулей не является gzip
tarball или browser bundle. Импорт полного IR и browser parse/first-render
этим измерением не квалифицированы. Пакетные ceilings не увеличены;
новый type dependency и остальные открытые delivery отказы ещё требуют
точной packed квалификации.
