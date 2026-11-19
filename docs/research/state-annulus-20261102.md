# Общее авторское обрамление и независимые состояния

Проекция объединяет существующие `enclosure.replace` и `annulus.counter-scale`.
Источник — Figma `LuaiBd4anRi4DMZayKAnY2`, baseline `2416636003859748575`.
Имена групп выводятся из действующих state/anatomy declarations: сейчас
status-circle имеет шесть states, playback-circle — два.

Компилятор получает полный annulus proof от существующего anatomy compiler.
Он проверяет master receipts, digest полного proof, соответствие runtime packet,
общие calibrated enclosure operands, paint, placement и текущую grid policy.
Нижняя scale-граница равна максимуму границ участников, верхняя — минимуму;
фактически вычисленный binary64 scale проверяется в `[minimum, maximum)`.
Групповой part ID выводится из state-декларации, а original enclosure ID каждого
master сохраняется в member receipt.

Индивидуальный glyph и групповая презентация используют один private материализатор.
Он меняет только inner countershape; runtime не разбирает path и не строит новый
proof. State patch не создаёт полный glyph и не вычисляет SHA. Exact default
возвращает исходный `d`. Новый opt-in package path сохраняет прежний state consumer.

Это соответствует [Magic Replace, WWDC25 337, 6:02](https://developer.apple.com/videos/play/wwdc2025/337/):
общая оболочка сохраняется, различающиеся слои заменяются. Алгоритм Apple закрыт;
сходство устройства не означает равенства реализации. [SVG2 §9.3.2](https://www.w3.org/TR/SVG2/paths.html#TheDProperty)
требует одинаковой структуры команд для интерполяции `d`, но это ещё не proof
топологической безопасности. В [MDN BCD](https://github.com/mdn/browser-compat-data/blob/cf5e164af1b35adc86c2c883aa4ad21a190468eb/css/properties/d.json)
Safari разбирает CSS `d`, не применяя его. Поэтому здесь геометрия меняется по
событию, а существующая анимация остаётся opacity-only.

Независимые Filled compound masters и семейства без принятого annulus не получают
эту проекцию. Одинаковый силуэт mic-circle не проходит существующий default
clearance; он остаётся контрпримером объединения по внешнему виду.

Source tests сравнивают patch со всеми восемью оригинальными masters и build
материализаторами, включая соседние binary64 запросы у обеих границ и genuine
individual-supported/group-refused запрос. Native ESM fixture проверяет реальные
imports, функцию identity, export surface и отсутствие нового модуля в прежнем
state-потребителе. Отдельный type consumer проверяет Bundler и NodeNext с восемью
отрицательными controls. Полный packed consumer, браузерная непрерывность,
оптическая приёмка и сравнительная производительность относятся к remote delivery
и не утверждаются этими source проверками.
