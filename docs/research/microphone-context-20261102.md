# Контекстная ширина микрофона

Заказчик 2026-11-02 подтвердил намеренное сужение корпуса микрофона в круге:
ширина может меняться относительно высоты, пока форма воспринимается цельным
микрофоном. Это авторская оптическая адаптация.

Сохранённая Figma-версия `2416636003859748575`, файл `LuaiBd4anRi4DMZayKAnY2`,
показывает разные контекстные конструкции. Outline `mic`, узел `6431:3962`,
имеет полую capsule с двумя контурами и `evenodd`. Outline `mic-circle`,
узел `6431:3896`, имеет сплошной корпус, другую посадку и отдельное кольцо.
Их исходные paths остаются самостоятельными masters.

Для этой волны выбран общий параметр `bodyWidth`: ширина корпуса меняется
отдельно от высоты, подставки и обрамления. Полая форма требует отдельного
изменения внешнего и внутреннего пролёта, чтобы обычный `scaleX` не истончил
боковые стенки. Исходные operands и контекстная конструкция принадлежат compiler;
потребитель задаёт только множитель ширины. Default сохраняет точный master.
Геометрический допуск требует проверки контуров и просветов во всём интервале;
оптическая приёмка требует просмотра 16/24/48 и соседних вариантов.
Результат просмотра и принятая область описаны в
[оптической квалификации](capsule-optical-domain-20261102.md).

Этот выбор поддерживают первичные источники, прочитанные 2026-11-02:

- [Google Fonts XTRA](https://raw.githubusercontent.com/googlefonts/axisregistry/main/Lib/axisregistry/data/x_transparent.textproto),
  [XOPQ](https://raw.githubusercontent.com/googlefonts/axisregistry/main/Lib/axisregistry/data/x_opaque.textproto)
  и [YOPQ](https://raw.githubusercontent.com/googlefonts/axisregistry/main/Lib/axisregistry/data/y_opaque.textproto)
  разделяют внутренние пролёты и толщину вертикальных/горизонтальных штрихов.
- [SVG 2](https://www.w3.org/TR/SVG2/coords.html) и
  [FontTools TransformPen](https://fonttools.readthedocs.io/en/latest/pens/transformPen.html)
  описывают преобразование точек и controls существующих контуров.
- [Custom SF Symbols](https://developer.apple.com/documentation/technologyoverviews/custom-sf-symbols.md)
  и [WWDC21](https://developer.apple.com/videos/play/wwdc2021/10250/) требуют
  совместимых авторских masters для интерполяции и сохраняют явно нарисованные варианты.
- [WWDC25](https://developer.apple.com/videos/play/wwdc2025/337/) и
  [annotations](https://developer.apple.com/documentation/technologyoverviews/annotating-sf-symbols.md)
  связывают движение со слоями, guide points и совпадающим обрамлением.

Эти источники обосновывают параметризацию и анатомию; они не измеряют качество
Lab Icons. Общий shrink всего микрофона исключён контекстным master и изменением
его контрформы. Аналитическая замена capsule без fidelity proof не принимается.
Полные weight/opsz, генерация нового окружённого символа и его движения остаются
самостоятельными обязательствами r14. Успех этой вариации их не закрывает.

## Компоненты и переход выключения

Повторный проход по [WWDC23, 7:59–14:45](https://developer.apple.com/videos/play/wwdc2023/10257/)
уточнил штатный Apple workflow. Symbol Components создаёт circle/circle.fill,
badge и slash из variable base и переносит annotations и поведение. При уменьшении
base компенсирует вес через совместимые masters; автор корректирует посадку,
scale и weight. Ручное рисование каждого окружённого варианта не является
обязательным Apple-подходом. Отдельное автоматическое X-сужение mic-body этим
источником не подтверждено. Для Lab Icons компонент обрамления и оптический
закон части остаются разными решениями одного authoring compiler.

Актуальный `mic-off` — самостоятельный master со slash и четырьмя уже вырезанными
фрагментами корпуса/стойки. Удаление slash оставит неполный микрофон; его controls
также отличаются от `mic`. Поэтому такой вход требует точной замены авторских
состояний либо нового доказанного соответствия, а не обещания morph или реконструкции
из base. В [WWDC23, What's new in SF Symbols 5](https://developer.apple.com/videos/play/wwdc2023/10197/)
Apple объясняет пользу целых движущихся форм с erase layers: заранее вырезанная
геометрия затрудняет непрерывное движение. Это ограничение нынешнего master,
а не разрешение переписать его рисунок.
