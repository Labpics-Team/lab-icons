# Измерение внешнего consumer

`compare-consumers.mjs` запускается в штатном удалённом GitHub job. Guard
отвергает локальный запуск. Браузер и нагрузка не устанавливаются и не запускаются
на рабочей станции.

Сравниваются исходный commit `03a4ca3ac1bf7978f9e8f554106c132a69668afb`
и точный `HEAD` задания. Каждый получает свежий checkout, frozen install и один
`pnpm pack` с настоящим `prepack`. Tarball устанавливается offline в новый проект.
Отчёт сохраняет source SHA, lockfile и tarball SHA-256, версию пакета и окружение.

Сравнение имеет две области. Retained использует root и полный IR: статический
accessibility, исходный alert, принятую модель time, default и поддержанные
weight/opsz у chevron-forward. В этой области SHA-256 полученного SVG обязан
совпасть; отличающийся результат останавливает сравнение.

Current author использует новые symbol modules с captured Figma geometry.
Изменённый рисунок проверяется против точного master/manifest: контуры,
эффективный fill-rule, z-order, part identity и author provenance. Все 660
вариантов установленного пакета проверяются отдельным process перед benchmark.
Alert/time/chevron сравниваются с проверенным retained baseline; новый
caret-forward имеет только candidate измерение. Geometry и representation
изменяются одновременно, поэтому эта область не доказывает same-geometry
speedup. В отчёте сохранены обе идентичности и структурная сложность SVG.

Для 1, 100 и 10000 символов сохраняются семь независимых Node процессов и три
browser context. Порядок baseline/candidate чередуется. Сырые повторы,
среднее, sample standard deviation и standard error доступны в JSON; плохие
наблюдения не отбрасываются. Ошибка сохраняет частичный отчёт и красный job.

Дополнительный matched static lane сравнивает Outline/Filled accessibility
из одного установленного candidate tarball с **тем же SVG literal**. Native
button, имя, декоративный SVG и его размеры совпадают; harness загружен отдельно
и исключён из обоих minified bundles. Отчёт сохраняет raw/gzip/brotli, точный
SVG hash и `bytesInOutput` для retained inputs. Parsed inputs не считаются
доказательством shipped runtime. Recorded motion сохраняет собственный единичный
measurement harness внутри своего bundle; static byte budget к нему не применяется.

Node измеряет cold/warm import, создание SVG, GC, полный жизненный цикл,
heap и RSS. Он не притворяется браузерным рендерером. Chromium отдельно
измеряет импорт consumer bundle, создание DOM, mount/layout, возможность первого
paint, rAF-интервалы, DOM-элементы, mutations и CDP-память при mounted DOM,
после cleanup и GC. Button имеет подпись и hit target 44 px.

Cold span теперь начинается **до** dynamic import и включает обязательные create,
DOM и mount до native `first-contentful-paint.startTime` пустого документа.
Ранний/отсутствующий/неподдержанный FCP вызывает отказ; rAF не заменяет его.
Warm import следует после полезного результата. Milestones и отдельные
paint/presentation fields сохраняются без утверждения о времени фактического
показа GPU. HTTP cache выключен, но browser process и OS cache общие: это
context/module cold, а не machine cold или доказанная независимость всех samples.

`report.analysis` разделяет наблюдённые byte budgets и conditional quantile
inference. Source hashes метода и анализа, decimal targets и uncertainty scope
сохраняются до анализируемых static/server/browser observations. Binomial tails и nearest ranks вычисляются точными
целыми числами; budgets/confidence/quantile интерпретируются как десятичное
`String(number)`. Исходные измеренные значения сохраняют binary64 identity;
ratio boundaries округляются наружу, а budget сравнивается с точным отношением
наблюдённых endpoints. Отсутствующий хвост, значения ниже заданного resolution и
непредставимая арифметическая граница возвращают `INCOMPLETE`; отсутствие clock
qualification остаётся отдельным открытым обязательством. Нулевая работа не получает tolerance. Calibration
имеет fixed 95% policy и максимум 5%; noisy sample не расширяет hard cap.

Этот запуск не выполняет baseline-only calibration и независимый frozen-run
qualification. Три browser samples не доказывают p95 confidence, а совпавший
byte budget не закрывает warm/CPU/memory/motion/fidelity conjuncts. Поэтому
успешное исполнение consumer procedure может сохранять `benchmarkStatus:
INCOMPLETE`; это не BENCH-01 PASS. Наблюдённый FAIL byte budget делает job красным.

Движение time.advance из recorded полного IR проходит через обычные WAAPI keyframes и публичный
`@labpics/motion@0.5.0`. Проверяются прерывание с обратным направлением,
неподвижный dial, reduced motion и уникальные mask IDs. Непрерывность
численно проверяется у обеих стрелок первого экземпляра; число 10000 не
обещает независимую оптическую приёмку каждой маски. Новое движение не имеет
старого API-baseline: результат характеризует исполнение, а не speedup.
Current source symbols должны точно отказать axes/candidate
(`AUTHOR_PARITY_REQUIRED`) и motion (`SEMANTIC_MOTION_UNAVAILABLE`). Принятые
recorded axes/gesture не выдаются за current Figma parity.

CDP rate 4 — синтетическое замедление CPU, а не измерение на конкретном слабом
устройстве. Viewport 1280×800: большие сцены содержат offscreen DOM. rAF
измеряет возможность кадра, а не presentation time GPU. Heap — наблюдение
в выбранные моменты, а не доказанный peak. Небольшое число повторов не
характеризует редкие хвосты. Pack/install/bundle compile записываются один раз.

Production bytes и module graphs отдельно собирает
`scripts/measure-platform-artifacts.mjs --output …` из уже собранного candidate.
CI не запускает `--update` и не принимает собственный результат за новый budget.

Источник исполнения — [ARC owner](https://github.com/Labpics-Team/Labpics-infra/blob/main/services/github-runners/arc/README.md).
Проверенный 2026-11-01 infra commit `8a7194f1dcc1bb6d630abb2946e8c72d0b9d501f`:
Ubuntu 26.04, одноразовый Pod, Linux/amd64, sudo для runner. Playwright 1.64.1
объявляет Ubuntu 26.04-x64 и native dependencies; `install --with-deps chromium`
использует этот штатный путь. Фактическое исполнение подтверждает только CI.
Trusted native jobs сохраняют `pnpm verify` и стандартные labels
`self-hosted, Windows/macOS, X64`. Self-hosted native capacity этим источником
не установлена; org inventory вернул HTTP 403. Эта очередь остаётся открытым
delivery gate. Linux-результат не закрывает native проверки.

Первичные источники метода:

- [Chromium CPU throttling](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setCPUThrottlingRate): slowdown factor, 1 без замедления.
- [Chromium Performance](https://chromedevtools.github.io/devtools-protocol/tot/Performance/): текущие runtime metrics, duration domain `timeTicks`.
- [Playwright CDP session](https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session): только Chromium; независимые context.
- [W3C Paint Timing](https://w3c.github.io/paint-timing/): FCP включает отрисованные SVG descendants; timestamp не заменяет proof GPU presentation.
- [MDN PerformancePaintTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformancePaintTiming): native paint observations и support boundary.
- [Lehmann and Paromau, quantile uncertainty](https://doi.org/10.1016/j.mlwa.2026.101033): order-statistic/binomial confidence и ограничения малого sample.
- [De Angelis, Hall and Young, coverage error](https://www.math.wustl.edu/~kuffner/AlastairYoung/DeAngelisHallYoung1993a.pdf): bootstrap percentile intervals не устраняют автоматически quantile uncertainty.
