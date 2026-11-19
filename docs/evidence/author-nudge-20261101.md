# Направленное авторское движение: 2026-11-01

Срез сохраняет Figma `LuaiBd4anRi4DMZayKAnY2`, версию
`2416636003859748575`, independent Outline/Filled masters восьми семейств
`chevron-{back,forward,up,down}` и `arrow-{back,forward,up,down}`.
Новые контуры, оптические координаты и оси не добавлены.

## Реализация

Закон `direction.nudge` требует явного направления и одной цельной замкнутой
управляющей части. Его линейная шкала 0 → 1/8 размера viewBox → 0 компилируется
в effect v3 с `x/y`, единицами `viewBox`, стабильным `partId` и этапами времени.
Lab Motion 0.5.0 исполняет публичный scalar `sequence`; Lottie использует
те же этапы как position keyframes. Геометрия остаётся статической.

Source commits: author `addddd5763a47359e2e4667006a2b9a659dd4158`,
Lottie `530c4afa640b709809c7dc7687699662106c5239`,
core `75167adc3de2c5c540e5db229e4e1d65fc43561d`, consumer `bf77296`.

## Проверено

- [Observatory receipt](author-nudge-consumer-20261101.md): реальный публичный
  Lab Motion, 355 checks, все 16 вариантов на 16/24/48 px, nonzero viewBox,
  фазы 0.25/0.75, pause/new-target/repeat/reduced и реальные Lottie downloads.
- [Lottie source receipt](author-nudge-lottie-source-20261101.json):
  14 семейств, 28 masters, 441 observations на 16/24/48 px;
  `lottie-web` 5.13.0, Chromium 156.0.8078.4. Все same-cubic alpha/RGB
  сравнения прошли; восемь deliberate mutants обнаружены. SHA256 receipt:
  `68bbbbbbcb13128bce9bbb0768db462341c116819ffa4a23872f7f0978f29d8b`.
  [Рендер](author-nudge-lottie-20261101.png) просмотрен; SHA256
  `b27b248bb766c530059b449a43630d04fd4dc114c97bfbecf692554e28842fad`.
- Core source tests на `2b5f9a2`: 28 PASS в четырёх focused files;
  standalone TypeScript check перед этим изменением прошёл.

Первичный source путь и импортированная source fixture проверены, но это ещё
не installed packed Icons consumer. Native SVG scan conversion отличается
от геометрически эквивалентных zero-tangent cubics; исходные результаты
`nativeRaster` сохранены отдельно. Нулевая same-cubic ошибка не удостоверяет
полную оптику корпуса.

## Контрпримеры и исправления

Fixed-canvas topology checker раньше игнорировал translation и мог вернуть
PASS для неподвижной геометрии. RED подтвердил отсутствие отказа; теперь
`motionEntriesAt` и `proveMotionTrajectory` дают `MOTION_PROOF_UNSUPPORTED`.
Этот legacy proof не учитывает swept viewport. Правило SVG `overflow: visible`
не создаёт clipping rectangle ([MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/overflow));
отождествлять его с fixed raster canvas нельзя. Target proofs находятся выше.

Ревью `75167adc` обнаружило потерю одного aggregate capability-канала у двух
отдельных жестов одной части по X и Y. RED воспроизвёл last-Y projection;
`2b5f9a2` включает ось в identity `translate.<axis>.<partId>` и сохраняет оба
канала. Идентичности прежних rotate/opacity каналов сохранены.

Circle-варианты отказывают: цельная Filled форма и независимое Outline enclosure
не дают одной и той же переносимой внутренней части. Отсутствие соответствия
не маскируется перемещением всей оболочки.

## Открытые gates

Полная independent optical admission всех Figma masters, packed consumer,
bundle/performance comparison и exact-head required CI/review не закрыты.
Figma Console probe повторён 2026-11-01: `Transport closed`; это отказ
Desktop Bridge transport, а не доказательство отказа доступа к самому файлу.
Новые source срезы не означают merge, npm publication или runtime release.
