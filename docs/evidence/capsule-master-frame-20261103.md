# Авторский frame микрофона

CI [41577161334](https://github.com/Labpics-Team/lab-icons/actions/runs/41577161334)
проверял head `8a8dee5a3d9eed4169dfcf10d02e21bbbc5e4c84` через merge source
`9b40b498927c63f77448e626f2405eb7e0d06ef0`, Chromium `156.0.8078.4`.
Journey прошёл сравнения многоточий и отказал на
`mic/outline/capsule-width/source-viewport`.
Архив `13204576612`, SHA-256
`6a36028fd2e059e4e4f52751246abed7faec62e76e69402c04a0a936776d6f2d`.

Первый conjunct ошибочно требовал непосредственных path children у raw master.
Все четыре сохранённых mic/mic-circle masters имеют Figma-группы `g` с `id`
и `data-node-id`. Например, Outline mic — узел `6431:3962`, master SHA-256
`c526c734a2225a29ec6e71f76d860546f5bccf8475bad6e1842915a75f2a5f9c`,
снимок `2416636003859748575`. Вложенные группы не задают transform или paint.
Требование direct paths к этому source гарантированно возвращало false ещё до
наблюдения live viewport. [SVG-группы](https://www.w3.org/TR/SVG2/struct.html#Groups)
сами по себе не изменяют координаты; frame и viewport сохраняют собственный смысл.

Author observer допускает только нейтральные SVG-группы с metadata и конечные
path leaves. Transform, opacity, style, filter, handlers, чужой namespace и новый
viewport не принимаются. Канонический output и экспорт сохраняют отдельное
требование direct paths. Dimensions, viewBox, отсутствие преобразований и
проверка живого экранного масштаба сохранены; failure теперь содержит оба frames.
Ни master, ни production compiler/runtime не изменены.

Четыре настоящих XML masters разобраны без преобразований и воспроизводят старый
false; новый author frame проходит. Одиннадцать новых и 55 существующих адресных
source tests прошли. Это закрывает ошибочное требование к raw source; успешный
live/browser результат нового SHA подтверждается только следующим remote CI.
