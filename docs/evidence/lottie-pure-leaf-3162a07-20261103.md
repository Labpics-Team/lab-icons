# PURE и размер compound Lottie

**Diátaxis:** reference. Source `3162a07b0815699079747525783c41af8fd002f4`,
измерение `2026-11-03T15:30:49.766Z`, Node 24.15.0.

Полное сжатие generated module удаляло PURE перед factory call.
Теперь сжимается только объявление данных; imports, аннотированный call и
публичные wrappers выпускаются структурным template. Неизменённые layered
modules сохраняют прежние байты. Проверки обнаруживают удалённую annotation,
потерю bindings, target data и ошибку forwarding. 97 focused tests прошли
одним worker, без skipped; syntax и diff checks также прошли.

| Artifact | raw B | gzip B | Сохранённый потолок raw/gzip B |
|---|---:|---:|---:|
| `dist/lottie/mic-circle.js` | 7682 | 2760 | 7891 / 2845 |
| `dist/ir/lottie-runtime.js` | 10409 | 3724 | 11590 / 3776 |

[Receipt](lottie-pure-leaf-3162a07-20261103.json) содержит input/output SHA,
предыдущие политики и scope. Выполнены только два leaf artifacts штатными
`bundle` и `renderLottieSymbolModule`; gzip — штатный `measureArtifact`,
fflate 0.8.3, level 9, mtime 0. Compilation runtime заняла 19 ms;
это наблюдение одного запуска, без performance claim.

Изменены только два factual baseline поля `mic-circle`; прежние ceilings,
module allowlists и остальные 1462 записи сохранены. Полная сборка, tarball,
browser и benchmark локально не запускались. Независимое удаление unused call
без package-level `sideEffects` доказывает сохранение annotation; регрессия
целого опубликованного пакета этим control не установлена. Exact-head remote
package/player/consumer checks и отдельная native optical приёмка остаются открытыми.
