# Calendar-number · явная дата в общей модели

Следующий срез после принятого clock `da534ef`; календарь пока не принят и не
выпущен. Цель — явные Date/Instant + IANA zone на общем пути SVG/Compose/Motion,
затем общий экспорт Lottie и каталог.

Выбранная граница: `date` и `timeZone` — свойства существующего символа. Дата
обозначает instant; скрытых часов и локального разбора строк нет. Web использует
Intl, Compose — kotlin.time.Instant и kotlinx-datetime. Изменение дня сохраняет
символ, вариант и общую оболочку. Совпадение слота не доказывает соответствие
точек разных цифр: первая смена содержимого использует crossfade.

Источник — собственные 10 rounded-цифр `src/core/calendar-geometry.js`. Штрих
остаётся явным paint, потому что SVG, Compose и Lottie умеют его рисовать.
Компилятор выдаёт совместимые числовые masters и scalar coefficients толщины
и размещения; runtime только выбирает и интерполирует их. 31 полная копия
календаря, font, SVG parser, boolean и генератор кривых в runtime не нужны.

Оболочка берётся из принятого `calendar-number`, сохраняя оптику: Outline path 2;
Filled path 0 contour 0 и path 1. Эти связи находятся в анатомии источника.
Viewport цифр ссылается на внутренний контур Outline-оболочки на каждой опоре.
Общий `contentScale: .75` сохраняет поля. Первый рендер со старой фиксированной
апертурой располагал цифры выше центра: она принадлежала другому рисунку оболочки.
Привязка к нынешнему source-window устранила эту случайную зависимость. Все
принятые 660 вариантов успешно прошли проверку прежних review digests в build:ir.
Старый IR wrapper использует отдельный calendar-clear и прежние fingerprints;
его нужно перевести на общий результат вместе с новым API.

Независимая рекомендация implement_labui_native: разрешать timezone→day на
границе платформы, хранить выбранный день и общую геометрию; смена даты не должна
сбрасывать Motion/state. Проверить UTC/Tokyo/LA около полуночи, DST, leap day,
invalid zone; 1/8/10/11/28/31 на крайних весах и оптических размерах.

Web реализован: `renderIcon`, `mount`, `setDate`, сохранение даты в `setState`,
сохранение остальных опций в `setDate`, snapshot изменяемого Date. Неверная дата
отвергается до изменения DOM и остановки действующего перехода. Общее покрытие
применяет alpha ко всему слою один раз; оболочка остаётся видимой при crossfade
цифр. После завершения удаляются старые цифры и пустые маски/слои.

Проверки 17 ноября 2026:

- `pnpm build:ir`, `pnpm exec tsc --noEmit` — PASS.
- 67 тестов в 7 файлах — PASS: календарная геометрия/API, оптические часы,
  семантическая фаза, отрицательный draw, renderer, semantic symbols.
- `node scripts/verify-calendar-motion.mjs`: 558 сравнений
  (31 день × 9 опор × 2 начертания), максимальное среднее alpha-расхождение 0.
- Сохранены source-shell, прозрачный tint, UTC/LA/Tokyo и leap day,
  прерывание 8→28→29, selected, mutation snapshot, atomic invalid date, dispose;
  после исполнения live Motion values = 0.
- [Атлас Chrome](calendar-motion.png) просмотрен автором на 16/24/48 в обеих
  темах с исходным знаком в соседнем столбце. Это ещё не независимая приёмка.

Ближайшая работа: native v5/renderer/контроллер → installed headless consumer →
независимое ревью календаря. Далее остаются перенос legacy IR wrapper, общие
Lottie/dotLottie экспорты, каталог и выпуск 0.4.0.

Источники: [Kotlin instant → local date](https://kotlinlang.org/api/kotlinx-datetime/kotlinx-datetime/kotlinx.datetime/to-local-date-time.html),
[Lottie stroke и grouping](https://lottie.github.io/lottie-spec/1.0/specs/shapes/).
