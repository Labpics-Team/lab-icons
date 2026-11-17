# Семантический срез Icons · 17 ноября 2026

`symbols/<id>` содержит только свои оптические данные и жесты.
`states/<family>` отдельно подключает связанные авторские состояния.
Одна декларация `symbols/source.json#stateFamilies` производит web и Kotlin.

Проверены selection/check, direction, loading/reload, notification,
volume/progress и slash/off. В этом срезе calendar имеет четыре статических
состояния; явные дата/зона и движение времени остаются отдельной работой плана.

- `node scripts/verify-semantic-motion.mjs`: публичные entrypoints и
  `@labpics/motion@0.5.0`, Chrome. Прерывание/обратный ход/повторный оборот,
  shared enclosure, точный reduced endpoint, draw guide mask, disposal.
  После завершения всех controls — **0 живых MotionValue**.
- 78 адресных JS/TS-проверок: public types, исполнитель, источник,
  render и отсутствие соседних уровней громкости в простом импорте.
- `native/compose/gradlew desktopTest`: декодирован весь корпус, Float-геометрия
  сверена с web, пройдены три поведенческих теста native Motion.
- Отдельный `consumer` установил **локальный** Maven-артефакт Icons
  `0.4.0-semantic.2` и публичный `pics.lab:motion-compose:0.1.0`, открыл окно,
  выполнил retarget/selection/draw/level/reduced/dispose и сам закрылся.
  Это проверка выпускаемого артефакта, не публикация Icons в публичный Maven.

[Web](web.png) и [Compose](compose.png) просмотрены в фактическом рендере.
Частичная галочка на обоих изображениях — остановленный draw на 50% пути.

Первая проекция ошибочно прикрепляла все состояния к каждому symbol:
`volume` вырос примерно с 74 КБ до 661 КБ. Измерение нашло зависимость;
отдельный импорт state family устранил её. Расширять допустимый размер
простого импорта вместо исправления этой границы нельзя.
