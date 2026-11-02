# Переход между авторскими многоточиями

Проверено 2026-11-02 в изолированном checkout
`lab-icons-author-variation-20261102`, ветка
`feat/authored-triad-orientation-20261102`. Исходные мастера закреплены в
`semantics/figma-baseline.json`; геометрия Figma saved version
`2416636003859748575` не менялась.

| Проверка | Исход и область |
|---|---|
| `test/authored-contour-states.test.js` | Да: точные `d` обоих начертаний, единая прямая/обратная шкала, proof всех пар, default-only отказы, перенос и snapshot, удаление ненужных операций сборщиком, public NodeNext declarations и неверные запросы |
| `test/contour-state-artifact.test.js` | Да: публичный consumer в отдельном Node, оба модуля, JSON и промежуточные позы; подмена исходного ожидания и дефектные provider/sampler обнаруживаются |
| `test/authored-variation.test.js` | Да: прежние изменения размера/расстояния и семантические жесты сохранены |
| `test/package-artifact.test.js` | Да: тесты пакетного гейта с подменёнными внешними командами; фактическая упаковка ими не выполнялась |
| Release import closure и orphan controls | Да: целевые проверки `test/release-contract.test.js` и `test/symbol-modules.test.js` |
| Strict TypeScript для `src/ir/contour-runtime.ts` и `src/motion/index.ts` | Да |
| Генерация export surface и `check-docs-drift.js` | Да |
| Полная сборка, packed tarball, browser execution, 16/24/48, optical admission, remote CI | Не было в этом локальном срезе |

Численный контрпример закреплён в тесте: множители 1.1/0.9 сохраняют
достаточный endpoint gap, но расстояние реальных кривых при p=0.5 меньше
политики сетки. Compiler отвергает этот интервал. Отдельный RED показывает,
что `from:null` не должен молча становиться нулём; исправление возвращает
`INVALID_REQUEST`.

Изолированное численное ревью обнаружило почти нулевую South/East четверть,
которая проходит `dots.affine`, но схлопывается при p=0.01511. Контрпример
воспроизведён как RED. Compiler теперь проверяет каждый радиус от центра
отдельно; единая арифметическая формула промежуточных координат сохраняет
покоординатную монотонность.

Независимое ревью неизменяемого коммита и проверка общего потребителя
требуются перед заявлением готовности перехода. Математические основания и
первичные источники: [исследование](../research/authored-cubic-family-20261102.md).
