# Размер prepared capsule у установленного consumer

Измерение выполнено в [Lab UI run 41559501182](https://github.com/Labpics-Team/labui/actions/runs/41559501182/job/125666413059)
на source Icons `27b32aebc887795cb9c1c439d658b0205544a5fe` и consumer
`c149bdccd22584e45ce6c6559e9e5de5f1883059`. Время захвата —
`2026-11-03T01:36:45.889Z`. Linux x64, Node `22.19.0`, AMD Ryzen 9 5950X,
12 доступных CPU, 33 635 536 896 B памяти. Пакет установлен из собранного tarball;
workspace aliases в измеряемых imports не используются.

[Полный measurement](platform-size-27b32ae-20261103/platform-measurement.json.gz)
содержит 1455 artifacts и 36 consumer scenarios. SHA256 распакованного JSON:
`63ad2ea57b3b5ae43cdbb31dd1441a38e5bae07dd901015c5a60ac37eb928491`.
Проверены BEGIN/29 CHUNK/END, gzip, длина 820984 B, compressed 87484 B,
digest и source SHA. Lockfile SHA256:
`0bb03e42de120f119236cb4334f1bdd33659ce61bc8fc10901c65dff0d7df4c7`.

| Полный импорт семьи | Raw B | Gzip B | Brotli B | Прежний потолок raw/gzip B |
| --- | ---: | ---: | ---: | ---: |
| `varied-microphone` | 27018 | 8749 | 7241 | 27620 / 8783 |
| `varied-microphone-circle` | 24118 | 9164 | 7686 | 24720 / 9192 |

Сжатие и bundler точно закреплены в полях `packageMeasurement`,
`consumerMeasurement` и `brotliMeasurement` отчёта. Размер — детерминированный
результат этой сборки; ошибка времени и частоты кадров здесь не измерялась.
Исходное превышение и воспроизводимый контрпример имени функции сохранены в
[исследовании capsule runtime](../research/capsule-consumer-admission-20261103.md).

Из `candidatePolicies` закреплены фактические baselines трёх runtime artifacts
и шести прежних consumer scenarios; добавлено первое покрытие 12 artifacts
и 12 scenarios. Все прежние потолки, entry expressions, module allowlists,
forbidden markers и `identicalTo` сохранены. У отчёта нет policy violations
или retired artifacts. Coverage совпадает с `release/contract.json`.

Этот run завершился отказом browser proof: общий срок 120 s истёк в режиме
reduced motion при продолжающейся конечной работе. Измерение размеров завершено
до этого отказа. Оно не подтверждает browser, motion, visual, frame latency
или полную приёмку исходного задания. Конечная пара source/consumer и обязательные
CI/review остаются открытыми до нового удалённого запуска.
