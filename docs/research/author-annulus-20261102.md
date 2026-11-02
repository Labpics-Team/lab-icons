# Авторское кольцо с изменяемым обрамлением

Проверено 2026-11-02. Это build-only геометрический срез для `plus-circle` и
`minus-circle`, Outline. Публичный runtime, export map, state group и Figma
не изменены. Оптическая приёмка nondefault и browser/performance проверка
этого закона ещё не проведены.

## Источник и смысл

Авторская база — Figma `LuaiBd4anRi4DMZayKAnY2`, saved version
`2416636003859748575`, страница `4045:632`. Точные masters берутся из
`semantics/figma-baseline.json`. У plus component `6431:3751`, vector
`8935:9756`; у minus component `6431:4069`, vector `8935:9765`.

У обоих буквально одинаковый ring path, SHA-256
`e968e80eacbedc69a95420ccbfb386db9a4a6b5c77f728e206eb1e970308c5c9`.
Смысл `container` и независимые content IDs принадлежат действующей декларации
`status-circle` в `semantics/author-state-groups.json`. Compiler требует explicit
declared parts и привязанные file/version/master/path receipts. Сходства с кругом
недостаточно. Filled имеет собственный compound master и получает отказ.

Параметр `enclosureEmphasis` меняет только countershape кольца. Наружный контур
и содержимое сохраняются буквально. Это не глобальная ось веса или optical size.
Толщина берётся из авторского master; legacy grid `enclosureRing=1.5` её
не заменяет. У северного и южного внутренних cardinal spans есть различие на
один binary64 ULP: оно сохраняется, а северный span служит только калибровкой.

При `w=1` materializer возвращает тот же frozen default без round-trip.
Для других значений:

```text
C = общий cardinal/canvas center
R = северный outer span
r = северный inner span
T = R-r
s = (R-w*T)/r
P' = C+s*(P-C)
```

## Непрерывный геометрический допуск

Два буквальных `MCCCCZ` с opposite winding имеют общие cardinal anchors и
покоординатно монотонные controls в каждой четверти. Четверти занимают разные
квадранты; контуры простые и star-shaped. Положительная гомотетия сохраняет
эту структуру. Canvas-center anchor и неизменяемый outer control hull проверяются
относительно margin текущего grid.

Для кубики квадрат радиуса выражен в degree-6 Bernstein basis:

```text
c[k] = sum(i+j=k, choose(3,i)*choose(3,j)/choose(6,k)
                    * dot(P[i]-C,P[j]-C))
```

Минимум/максимум coefficients ограничивают саму кривую на всём интервале.
Content ограничен отдельным control-hull диском. Все дроби вычислены из точных
**binary64** исходных Numbers. Это иной объект, чем десятичные дроби первичного
исследования; приблизительные радиусы совпадают в показанных разрядах.

Пусть `Lo` — lower radius outer, `Li/Ui` — lower/upper radius inner,
`H` — upper radius content, `g` — minimum gap grid и `e` — Euclidean
materialization error. Допуск:

```text
(H+g+e)/Li <= s < (Lo-e)/Ui
```

`s*Li-H >= g+e` отделяет content от countershape; `s*Ui < Lo-e`
сохраняет положительную стенку кольца. Двоичные границы корней округляются
наружу с проверкой точного квадрата, а interval scale — внутрь с точным
рациональным сравнением. Проверяется фактически вычисленный binary64 scale,
поэтому округление weight→scale не может дать ложный admission на границе.

Для трёх операций `C+s*(P-C)`, `u=EPSILON/2`, `D=max|P-C|`,
`A=max|C|`, `S=Lo/Ui`:

```text
ec = u*S*D + u*S*(D+u*D) + u*(A+S*(D+u*D)*(1+u))
e = upper(sqrt(2))*ec
```

Бюджет считается точными дробями; metadata содержит его и обе стороны
ограничений. На nondefault materializer проверяет finite/noncollapsed quarters
из готовых координат, без нового path parsing или вычисления Bernstein bounds.
`emphasisBounds` описывают обратное отображение scale; дополнительная проверка
фактического scale остаётся обязательной.

Геометрическая область возле нижней границы допускает почти невидимую стенку.
Она **не утверждает** хороший рендер. Продуктовый визуальный диапазон должен
пройти отдельные реальные 16/24/48 renders и independent optical review.

## Контрпримеры и проверки

При `w=2.6` реальные endpoints показывают нарушение clearance 0.799992:
plus — расстояние 0.6506116891; minus — 0.6730775293. Эти точки проверены
непосредственно в raw paths. `w=0` совмещает cardinal nodes, большой `w`
схлопывает countershape. Это реальные нарушения, а не только отказ достаточного
control-hull bound.

`test/author-annulus.test.js` проверяет оба master, точный default, неизменённые
outer/content bytes, labels/order/paint, реальное изменение inner operands,
source receipts и precise refusals. Перепривязанные negative fixtures достигают
geometric admission: bad winding, broken quarters/closure/center, inverted
nesting, content collision и nonzero polarity. Проверены inward JSON boundaries
и соседние binary64 weights с принятым и отвергнутым исходом.

Узкий запуск установленного Vitest 4.1.12 на Windows, один worker: 13 tests PASS.
Полная CI, browser rendering, performance и consumer install **не выполнялись**
в этом срезе. `pnpm exec` отказал `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`; dependency
installation и тяжёлые suites локально не запускались. Итоговый exact certificate
и сведения о проверке находятся в соседнем JSON.

## Альтернативы и оставшаяся граница

Замена аналитической окружностью теряет авторские C operands. Масштабирование
всего glyph меняет содержимое и exterior footprint. Offset engine решает более
общую задачу, но добавляет clipping/topology/dependency стоимость, которая для
этого локального семантического параметра не нужна. Subdivision может ужесточить
радиальные bounds; нынешний Bernstein certificate уже пропускает полезные
nondefault, поэтому дополнительный движок не требуется.

В `author-contour-states.js` уже есть приватные exact arithmetic primitives.
Они **не изменялись** из-за параллельного ownership. Этот build-only compiler
пока содержит локальные операции; до общей интеграции их необходимо совместно
вынести к одному численному владельцу. Это явное условие интеграции, а не новая
постоянная архитектурная норма. Public variants/capabilities/runtime/types и
format adapters остаются у владельца `author-variation`.

Admission plus/minus не расширяет `status-circle`: каждый участник перехода
должен подтвердить тот же запрос на обрамление и свой content clearance.
`ellipse` и `time` имеют другие авторские controls и не подменяются этим master.

## Первичные источники

Исследование `/root/next_author_family_explorer` прочитало источники 2026-11-02:

- [SVG 2 paths](https://www.w3.org/TR/SVG2/paths.html): cubic operands и compound fill.
- [fontTools TransformPen](https://fonttools.readthedocs.io/en/latest/pens/transformPen.html)
  и [implementation](https://raw.githubusercontent.com/fonttools/fonttools/main/Lib/fontTools/pens/transformPen.py):
  affine преобразование всех controls.
- [Nairn–Peters–Lutterkort](https://docs.lib.purdue.edu/cstech/1399): прочитанная
  альтернатива subdivision bounds; Hausdorff theorem здесь не используется.

Эти источники обосновывают геометрические операции, а не визуальную приёмку Lab Icons.
