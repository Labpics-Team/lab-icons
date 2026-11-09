# Размеры новых авторских представлений

**Diátaxis:** reference. [Self-hosted Lab UI consumer](https://github.com/Labpics-Team/labui/actions/runs/41642656235/job/125939807793)
завершился SUCCESS для Icons `d703b7b6713b7f06408b88e8260f65d118596f1f`
и Lab UI `677ac981168e5a33252251cba3b2007bda36ad98`.
Измерение выполнено 2026-11-03T13:32:51.547Z штатным
`scripts/measure-platform-artifacts.mjs` после сборки в этом runner.

Политика содержит 1463 артефакта: восемь новых файлов добавлены по
[полученным измерениям](presentation-policy-admission-d703b7b-20261103.json).
Все 1455 прежних записей сохранены целиком. Новые потолки равны первым
измеренным raw/gzip размерам; прежние ограничения не увеличены.

| Модуль состояния | raw B | gzip B |
|---|---:|---:|
| `microphone-presentation.js` | 5634 | 2486 |
| `microphone-presentation-filled.js` | 4896 | 2286 |
| `plus-presentation.js` | 3979 | 1804 |
| `plus-presentation-filled.js` | 3704 | 1749 |
| Каждый Outline `.d.ts` | 864 | 275 |
| Каждый Filled `.d.ts` | 857 | 274 |

Gzip: `fflate@0.8.3`, level=9, mtime=0. Среда: Node 22.19.0,
Linux x64, AMD Ryzen 9 5950X, 12 доступных CPU. Receipt сохраняет
SHA каждого файла, lockfile, версии инструментов и digest полученной проекции.
Существующий codec проверил длину, digest и порядок всех 29 chunks.

`allowedModules` описывает метаданные отдельного артефакта по действующему
oracle; пустой массив не обещает отсутствие транзитивных runtime imports.
Стоимость полной потребительской сборки проверяется отдельно. Эти новые
файлы не изменяются последующим Lottie lowering; новая ревизия всё равно
обязана пройти полный package guard и удалённый installed consumer.
Измерение не подтверждает npm-публикацию или завершение общей миссии.
