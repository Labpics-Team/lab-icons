# Публичный Symbol API: локальное измерение

18 ноября 2026 проверены `renderIcon` и `createSymbolMotion().mount` из отдельно
установленного **production tarball 0.4.0**, исходники `6095155`, Lab Motion 0.5.0.
Архив SHA-256 `d96db529c3c9e0889ce633444a4a9d7fbf09848808cb09f48eba02e72d414197`.
Обычный `prepack` собрал весь принятый корпус; preview не использовался.
Runtime в этом изменении не менялся. [Полные исходные наблюдения](report.json)
содержат hashes метода/bundles, retained inputs и результаты каждого повтора.

Windows 11 (10.0.26200), i9-12900K, Node 24.15.0, Playwright 1.64.1,
установленный Chrome **157.0.8103.51**, headless, без CPU slowdown.
По три независимых процесса/profile на каждую комбинацию API × 1/100/1000.
Порядок API чередуется; CPU/OS cache не изолируются. Знак `reload`, Outline,
size 20 CSS px, weight 500, opsz auto (20). Весь ряд находится внутри 1280×800.

| API | Число | Импорт, мс | Import→FCP, мс (min…max) | Создание, мс | DOM elements | GC heap сверх пустой страницы, КиБ |
|---|---:|---:|---:|---:|---:|---:|
| renderIcon | 1 | 2.51 | 53.00 (10.52…101.71) | 0.79 | 3 | 229.1 |
| renderIcon | 100 | 2.96 | 113.90 (15.19…129.03) | 4.06 | 300 | 266.8 |
| renderIcon | 1000 | 2.55 | 157.36 (131.64…158.62) | 21.66 | 3000 | 314.5 |
| Motion mount | 1 | 4.39 | 126.96 (117.52…130.39) | 1.16 | 4 | 296.6 |
| Motion mount | 100 | 4.40 | 120.69 (14.44…124.39) | 4.43 | 400 | 546.4 |
| Motion mount | 1000 | 4.25 | 165.21 (121.28…166.44) | 19.48 | 4000 | 2030.0 |

В таблице медианы трёх наблюдений. DOM учитывает slot и SVG descendants;
общий `main` не включён. Импорт и создание измерены одним `performance` clock.
FCP — нативный timestamp первого содержимого изначально пустого документа,
после полного синхронного mount. rAF его не заменяет. Разброс FCP велик;
причина отдельно не установлена, порядок строк не доказывает разницу скорости API.

Bundle `renderIcon + reload`: **43 715 B raw / 15 672 B gzip / 12 181 B Brotli**.
Bundle `createSymbolMotion + reload + public Lab Motion namespace`:
**106 664 / 36 868 / 31 059 B**. Это явно выбранные consumer exports, не нижняя
граница bytes любой интеграции. Harness и инструментирование загружаются отдельно.
В каждом bundle удерживается ровно одно семейство; legacy `/ir`, authoring и
каталог отсутствуют, статический bundle не удерживает Motion.

| Одновременно активных | Cycle: средний rAF callback, мс | Оптика: средний rAF callback, мс | Cycle: уведомлений за окно | Оптика: уведомлений за окно |
|---:|---:|---:|---:|---:|
| 1 | 0.075 | 0.106 | 74 | 74 |
| 100 | 0.342 | 1.741 | 7100 | 7300 |
| 1000 | 2.862 | 18.031 | 37000 | 12000 |

Здесь медианы средних callback costs каждого повтора. Измеряется весь
callback rAF Lab Motion, включая writer Icons и счётчики. Внутренний subscriber
cost также сохранён: на 1000 символов 1.72 мс для cycle и 16.85 мс для оптики
на callback. Окно — 300 мс после синхронного запуска всех controls; полное elapsed
и стоимость запуска сохранены отдельно. Длительность запроса 2000 мс,
cycle останавливается посреди движения; затем `set(weight:600)` переходит от
видимой позы и удаляется через `dispose()` во время исполнения. Частота rAF
не ограничивается искусственно: число callbacks и интервалы сохранены в JSON.

1000 оптических обновлений уже стоят **около 18 мс на callback** на этой машине.
Результат не обещает 60 fps при такой нагрузке. Это измерение конкретного пути,
а не утверждение о стоимости всех форм и эффектов корпуса.

Во всех 200-мс интервалах idle, stop и dispose получены **0 rAF requests,
0 executed callbacks, 0 SVG writes, 0 notifications**; ожидающих кадров,
MotionValue и подписок — тоже 0. Статический mount не создал MotionValue,
ResizeObserver или rAF. Остановка/удаление завершили все активные controls
со статусом `stopped`. После удаления и GC число DOM nodes вернулось к baseline.

Heap — CDP snapshots после принудительного GC, включая установленный module и
harness. После dispose остаток сверх пустой страницы составляет 230…284 КиБ
для static и 488…847 КиБ для Motion (медианы); это включает загруженный runtime,
JIT и сохранённые измерителем samples. Это не peak allocation и не доказательство
отсутствия утечек во всех жизненных циклах. CDP Script/Layout/Style/Task durations
сохранены как отдельные показатели движка; JS из `page.evaluate` не следует
приравнивать к одному ScriptDuration.

Повторить из checkout с установленными dependencies:

```sh
node scripts/bench/measure-public-symbols.mjs --chrome --output preview/public-symbols/report.json
```

Команда закрывает headless Chrome/server и удаляет временную упаковку/consumer
в `finally`. Первый пробный запуск не дал наблюдений: bundled Chromium нужной
версии отсутствовал. Использован уже установленный Chrome; новые браузеры
не устанавливались. Старый `compare-consumers.mjs` и его 1/100/10000 IR-нагрузка
не менялись. Три повтора не дают p95 confidence, сравнения с прежней реализацией
или полного performance budget; `PASS` означает выполнение сцены и перечисленных
проверок жизненного цикла.

Основания метода: [W3C Paint Timing](https://w3c.github.io/paint-timing/),
[Chrome Performance metrics](https://chromedevtools.github.io/devtools-protocol/tot/Performance/),
[Chrome heap usage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage),
[Playwright CDP session](https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session).
