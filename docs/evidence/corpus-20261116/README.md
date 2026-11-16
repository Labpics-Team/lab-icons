# Проверка CORPUS-01

На 2026-11-17 корневой пакет и `/symbols/<id>` воспроизводят все 660 авторских SVG.
Figma не изменялась. [Прямая сверка сохранённой и live версий](../figma-20261116/live-comparison.json)
показала отсутствие изменений компонентов; повторный экспорт не понадобился.

Проверены `pnpm build`, `pnpm typecheck`, source-проекции, runtime export surface,
package/consumer size, docs drift и clean tarball через `check-package-artifact`.
Последняя проверка собирает пакет заново, устанавливает его в отдельный каталог и
проверяет ESM, TypeScript, author glyph/state/variation API и отказы повреждённых
source-артефактов. Vitest проверяет источник, sync нового снимка, потерю устаревших
аннотаций, неизменность старых masters, shared circle, все root/per-family строки,
публичный surface и совместимость build/repo/consumer-size контрактов.

Снимки `atlas-1.png` … `atlas-7.png` покрывают весь авторский корпус при 16/24/48 px.
Они получены в настоящем Chrome, DPR 1, viewport 1600×2000. Переполнений карточек нет.
Верхняя сцена показывает plus/minus/checkmark/mic в обычных и выбранных кнопках обеих
тем. Это source-preview с системным fallback шрифта; полное оптическое сравнение с
Geist относится к OPTICS-01. Для воспроизведения: `node scripts/build-source-atlas.mjs`.

[Размеры до и после](size-changes.json) фиксируют рост полного импорта из-за
перехода на весь авторский корпус и сохранения точных path. Один статический
plus-circle занимает 1090 B JS / 553 B gzip; bundle содержит только SVG-литерал.
Compiler, motion и соседние символы в него не входят. Полный старый IR остаётся
отдельным compatibility-импортом.

Оптические оси всего корпуса, новый render runtime, motion/native экспорт,
полноценный каталог и выпуск 0.4.0 этим срезом не объявляются завершёнными.
