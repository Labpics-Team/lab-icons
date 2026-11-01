# Замена внутреннего знака с общей оболочкой

Исследование и source-срез 2026-11-01. Потребность — менять символическое
состояние, разворачивать переход и принимать новое намерение, сохраняя
авторскую геометрию Lab UI v2.1 и видимую непрерывность.

[WWDC25, SF Symbols 7, глава Magic Replace 6:02](https://developer.apple.com/videos/play/wwdc2025/337/)
описывает сохранение совпадающих enclosures при одновременной замене отличающихся
layers. Это подтверждает пригодность композиции без arbitrary contour matching.
Никакие Apple artwork или proprietary assets не используются.

[SVG 2 §3.6](https://www.w3.org/TR/SVG2/render.html#Groups)
определяет group compositing и применение opacity к уже отрисованной группе.
Поэтому внутренние paths question/attention имеют общий opacity target;
изменение каждого path отдельно не было бы эквивалентно при перекрытиях.

## Точный authored domain

Figma file `LuaiBd4anRi4DMZayKAnY2`, snapshot `2416636003859748575`,
Icons page `4045:632`, Outline frame `8513:1000`.

| Значение | Символ | Outline node |
|---|---|---|
| confirmation | checkmark-circle | `6431:4056` |
| dismissal | close-circle | `6431:3870` |
| question | question-circle | `6431:3733` |
| attention | alert-circle | `6431:3740` |
| increase | plus-circle | `6431:3751` |
| decrease | minus-circle | `6431:4069` |

У выбранных masters последняя path содержит одинаковый enclosure `d`:
SHA-256 `e968e80eacbedc69a95420ccbfb386db9a4a6b5c77f728e206eb1e970308c5c9`.
Размеры и viewBox — 24; paint — currentColor, fill-rule — evenodd,
transforms отсутствуют. Interior d/rules/order сохраняются буквально.
Paths не перенумеровываются по близости: IDs задаёт versioned semantic spec.

## Альтернативы и различители

| Способ | Проверенное ограничение | Решение |
|---|---|---|
| Morph по числу точек/nearest contour | Знак question содержит dot и stem; check/plus/minus имеют другую топологию. Совпадение внешнего кольца не задаёт correspondence interior | Не объявлять morph |
| Заменить весь SVG | Статический endpoint точен, но shell/DOM identity теряются; interruption начинается заново | Оставить static export; transition сохраняет группы |
| Анимировать каждый interior path | Object opacity и group opacity различны при compositing перекрытий | Применять opacity целой группе |
| Две постоянно создаваемые группы | При третьем намерении нужно сохранить многокомпонентную текущую смесь либо потерять continuity | Один bounded mounted group на каждое объявленное состояние |
| Подключить новый animation engine | Публичный Lab Motion sequence уже принимает scalar opacity stages и подхватывает DOM pose | Сохранить generic effect contract, без scheduler в Icons |

Состояния называют знаки. В частности, close-circle не назначается ошибкой:
семантическую связь с действиями и доступным текстом задаёт приложение.

Filled checkmark-circle объединяет body и отрицательный mark-hole одной path;
он не имеет отдельной последней оболочки. Forced admission получает
`TOPOLOGY_UNSUPPORTED`. Новый допустимый master с другой enclosure координатой
или fill-rule получает `ENCLOSURE_MISMATCH`, даже с корректными новыми hashes.

## Реализация и границы проверки

Build compiler проверяет raw/normalized/path receipts, production glyph,
ordered paint и одинаковую рамку до выдачи всего payload. Общий SVG serializer
готовит enclosure и interior fragments. Runtime получает только строки,
semantic IDs и receipts; единственная variable state операция создаёт opacity
targets. Все группы остаются mounted, предыдущая visible смесь подхватывается
executor при смене намерения. Reduced motion задаёт конечные targets с duration 0.

Static SVG и web effect поддержаны. Group transition в Lottie/dotLottie/native
не экспортируется; format request получает точный отказ. Это не обещание
физической compositor-only реализации SVG opacity: browser raster cost и frame
budgets требуют remote measurements.

Bounded source tests проверяют raw endpoints, группирование, единственный
enclosure, отсутствие from/reset, refusals и adversarial geometry/paint/viewport
и compiler mutations. Existing package gate теперь исполняет тот же conformance
oracle в установленном tarball и strict type consumers. Полный build/install,
browser interruption, optical admission и release не объявляются выполненными
по этим source результатам.
