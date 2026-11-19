# Показать и настроить символ

```js
import icon from '@labpics/icons/symbols/plus-circle';
import { renderIcon } from '@labpics/icons/render';

const element = document.querySelector('#icon');
element.style.color = '#2463eb';
element.innerHTML = renderIcon(icon, {
  size: 20, variant: 'outline', weight: 500, opsz: 'auto',
});
```

`renderIcon` возвращает SVG-строку. `size` задаёт логические CSS-пиксели;
плотность дисплея не является оптическим размером. `opsz: 'auto'` следует size
в пределах 16…48. Явный `opsz` независим от размера: крупный предпросмотр может
показывать оптику 16. `weight` принимает 300…600. Оси и опоры находятся в
`icon.data.axes`; неверные числа и выход за явный диапазон отвергаются.

Outline и Filled имеют собственные авторские masters. Значения 400/24 сохраняют
исходные контуры. Между опорами числовые коэффициенты меняют толщину, просветы,
контрформы и оптические поправки; CSS stroke не заменяет конструкцию символа.
При использовании только исходного рисунка импортируйте именованный `outline`
или `filled`: сборщик может полностью удалить числовые данные и renderer.

SVG наследует `currentColor` и декоративен по умолчанию. Название действия
принадлежит кнопке. Для самостоятельного изображения задайте доступное название
контейнеру с `role="img"`.

Для смены свойств и прерываемого движения используйте
[createSymbolMotion](symbol-motion.md). Оптика, состояния и дата одинаковы
для SVG, [экспорта](lottie.md) и [Compose](../native/compose/README.md).
Часы и календарь получают явное время от приложения.

Ранние `glyph()` и `glyphCapabilities()` описаны в
[справке совместимости](symbol-modules.md). Их `AUTHOR_PARITY_REQUIRED`
не ограничивает `renderIcon` и `createSymbolMotion`.
