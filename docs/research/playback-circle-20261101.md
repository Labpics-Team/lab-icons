# Команды playback как второй потребитель общей оболочки

Исследование 2026-11-01. Потребность — заменить выбранный playback artwork,
сохранить авторские контуры и общую оболочку при новом намерении, reverse
и reduced motion. Действующий `enclosure.replace` выражает этот переход
без другого компилятора или scheduler.

## Авторская основа

Figma file `LuaiBd4anRi4DMZayKAnY2`, saved version `2416636003859748575`.

| Artwork | Outline node | Content parts | Enclosure index |
|---|---|---|---|
| play-circle | `6431:3965` | `play-mark` | 1 |
| pause-circle | `6431:4026` | `pause-first-bar`, `pause-second-bar` | 2 |

Raw masters находятся в `masters/figma/2416636003859748575/Outline/`.
Их byte hashes и normalized path fingerprints закреплены в
[Figma manifest](../../semantics/figma-baseline.json) и
[state spec](../../semantics/author-state-groups.json).
Оба последних raw path tags совпадают буквально, включая paint и rules:
tag SHA-256 `428f8397adcd3d75c175948fe79261aaf2618474d4f5f8bdca902daebbaddeb0`,
`d` SHA-256 `e968e80eacbedc69a95420ccbfb386db9a4a6b5c77f728e206eb1e970308c5c9`.
Контуры явно замкнуты; viewBox и размеры равны 24.

Это evidence сохранённой версии. Console transport недоступен; unsaved
Desktop parity и новая независимая optical admission не установлены.

## Смысл и доступность

[HTML media specification](https://html.spec.whatwg.org/multipage/media.html#playing-the-media-resource)
задаёт состояние медиаресурса, а
[MDN cross-browser player](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery/cross_browser_video_player)
показывает связь с доступной командой. Играющий плеер предлагает pause,
приостановленный — play. Поэтому state enum Icons называет выбранный знак,
а приложение владеет media state и его переходами.

[WAI Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) и
[MDN aria-pressed](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-pressed)
различают toggle с постоянным именем и кнопку с меняющейся командой.
Explorer выбирает artwork отдельными кнопками с постоянными именами;
встроенный медиаплеер ради демонстрации не требуется.

[Apple RTL guidance](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPInternational/SupportingRight-To-LeftLanguages/SupportingRight-To-LeftLanguages.html)
и [Qt RTL guide](https://doc.qt.io/qt-6/qtquick-positioning-righttoleft.html)
отдельно рассматривают media controls. Playback artwork не получает
автоматического зеркалирования по направлению текста.

## Различающие контрпримеры

`stop-circle`, Outline node `10018:1653`, имеет буквально ту же оболочку,
но первой path. Правильный master receipt с enclosure index 0 получает
`TOPOLOGY_UNSUPPORTED`. Указание index 1 сравнило бы stop mark с оболочкой
и получает `ENCLOSURE_MISMATCH`. Перестановка paths нарушила бы exact ordered
oracle. Действующий закон не расширяется этой похожестью.

Семейство aloof/sad/smile — более дорогой последующий кандидат. У него
совпадают глаза и последняя оболочка, а меняется mouth. Замена всего interior
также анимировала бы неизменные глаза: две перекрывающиеся группы с opacity 0.5
дают alpha 0.75, а не 1. Это расчётный контрпример по
[SVG group compositing](https://www.w3.org/TR/SVG2/render.html#Groups) и
[source-over](https://www.w3.org/TR/compositing-1/#simplealphacompositing),
не выполненный browser measurement. Сохранение общего suffix потребовало бы
отдельного доказанного закона. Playback использует существующий закон целиком.

## Замыкание среза

Spec определяет группы; прежний build выпускает отдельные modules и State
unions. Raw endpoint/mount/effect oracle и installed ESM consumer перебирают
все группы. Strict Bundler/NodeNext consumers также происходят из spec.
Удалённая pause bar с заново закреплёнными hashes должна отказать полному
part coverage. Geometry, scalar effect contract и Motion execution не меняются.

Runtime/packed player, browser interruption, small-size visual comparison
и фактические размеры требуют self-hosted результатов. Этот срез расширяет
настоящий домен применения закона, сохраняя полный объём product-lab-icons/r14.
