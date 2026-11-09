# Отклонённое сокращение деклараций символа

Исследование 2026-11-02 сравнивало generated declarations с Icons
`700f863f7cef3d7d17b3eadf29df699cdf144d4c`. Публичные функции и их перегрузки
сохраняются в прежнем шаблоне `symbolModuleDeclaration`: у этого изменяемого
решения уже один владелец. Общие интерфейсы и дополнительный type dependency
по итогам эксперимента не поставляются.

Первый вариант заменял function declarations на callable const со ссылкой на
общий `AuthorSymbolApi`. Обычные вызовы, literal ID и порядок перегрузок
проходили Bundler и NodeNext, однако существующее расширение функции перестало
компилироваться:

```ts
declare module '@labpics/icons/symbols/ellipse' {
  namespace glyph { let cached: string; }
}
glyph.cached = 'consumer metadata';
```

Прежняя декларация принимает этот consumer; const-вариант даёт TS2451 и
TS2339. Это наблюдаемая несовместимость. Штатные
[call signatures](https://www.typescriptlang.org/docs/handbook/2/functions.html#call-signatures)
не заменяют [function/namespace merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#merging-namespaces-with-classes-functions-and-enums).
[Вывод из последней перегрузки](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types)
также требует сохранять поведение `Parameters` и `ReturnType`.

Второй вариант оставлял function declarations и связывал сигнатуры через
`Parameters`/`ReturnType`. Он сохранял merging, но увеличивал gzip обеих
variation declarations и добавлял зависимость без нового предметного
контракта. Сохранение существующего шаблона оказалось более простым решением.

| Отклонённый вариант | Суммарный raw символов | horizontal raw/gzip | vertical raw/gzip |
|---|---:|---:|---:|
| Baseline | 149610 | 718 / 257 | 712 / 257 |
| Callable const | 95064 | 320 / 182 | 318 / 180 |
| Function wrapper | 134426 | 650 / 265 | 646 / 264 |

[Raw const experiment](declaration-sharing-const-20261102.json) и
[raw wrapper experiment](declaration-sharing-20261102.json) сохраняют отдельные
результаты. Область: только узкая declaration-сборка на Windows, Node v24.15.0,
TypeScript 7.0.2, fflate 0.8.3 level 9/mtime 0, Brotli 1.2.0 quality 11.
Dependencies измерены отдельно. Это не экономия текущего shipping package,
не browser bundle и не квалификация timing, build/pack или публикации.

Контроль в `test/authored-variation-types.test.js` сохраняет реального
Bundler/NodeNext потребителя, namespace metadata, literal IDs, перегрузки и
точные отрицательные диагностики. Удалены только неиспользуемый type helper
и probe отклонённой реализации. Runtime и авторская геометрия не меняются.
