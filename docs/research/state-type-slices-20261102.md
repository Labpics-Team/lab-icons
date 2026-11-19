# Независимые типы замены и морфинга

На `1d9c408c5491a40a3d2e1a3ae20786c6613a958e` любой enclosure consumer
загружал приватный `state-types.d.ts` со всеми contour requests, sampler и
геометрическим proof. Ни замена общей оболочки, ни её capabilities этих
типов не используют. Приватность этого specifier следует из package exports;
публичные функции находятся в `states/<group>` и `motion`.

Контракты разделены по используемой способности. Общие request/refusal/SVG
типы принадлежат `common-types.ts`; enclosure остаётся в `types.ts`, contour —
в `contour-types.ts`. Семь refusal codes и все публичные поля сохранены.
Contour и Motion импортируют свой helper напрямую. Все определения принадлежат
прежнему владельцу; runtime, geometry, masters и public exports не меняются.

[Type-only imports/exports TypeScript](https://www.typescriptlang.org/docs/handbook/modules/reference.html#type-only-imports-and-exports)
исключаются из runtime; [Node exports](https://nodejs.org/api/packages.html#package-entry-points)
определяет доступный внешний контракт. Первичные документы проверены
2026-11-02. Barrel с reexport contour из enclosure отвергнут: он вновь
загружал бы ненужный proof. Удалять поля, заменять типы на `any` или сокращать
refusal union для прохождения бюджета не требуется.

[Actual declaration emit](state-type-slices-20261102.json), полученный
[узким воспроизводимым probe](../../scripts/bench/state-type-slices.mjs):
Windows, Node v24.15.0, TypeScript 7.0.2, те же declaration/stripInternal,
ES2022, Bundler и strict flags; fflate 0.8.3 level 9/mtime 0.
Исходные 6385/1636 bytes совпадают с exact Icons700 self-hosted receipt.

| Артефакт | Raw / gzip bytes |
|---|---:|
| Прежний общий state helper | 6385 / 1636 |
| Enclosure helper | 2323 / 824 |
| Новый common helper | 523 / 283 |
| Новый contour helper | 3953 / 1257 |

Транзитивный raw с primitive provenance: enclosure **7163 → 3624**,
contour **7163 → 5254**. Все helpers вместе дают **7577**, на 414 bytes больше
прежней общей closure. Это цена независимого потребления и полезных публичных
типов; общей экономии tarball/gzip или ускорения TypeScript не заявляется.
Прежний enclosure ceiling 2576/908 сохранён. Начальные потолки добавлены только
для двух новых приватных declaration files по измеренному output.

Проверены реальный public NodeNext consumer, precise negatives и запрет private
subpath; enclosure dependency closure не содержит contour/geometry/catalog.
Manifest и release closure fixtures учитывают новые зависимости. Это узкие
source/type controls. Полные build/pack, exact-head self-hosted и performance
qualification остаются открытыми; Motion и остальные превышения этот срез
не закрывает.
