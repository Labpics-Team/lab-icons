# Публичная DesignSpec: source и граница поставки

Source freeze: `e12fa37792efe703bd22ab41dcdcde7d556b466c`.
Текущий срез связывает существующий parser/lowering с общим SVG assembler.
`compileDesignSpec` сохраняет IDs, роли, порядок, topology, именованные якоря,
декораторы и ограничения. Provenance имеет `kind: design-spec`, версию 1,
SHA-256 нормализованной спецификации и состояние `candidate`.

Новый знак не заменяет Figma masters. `size` задаёт размеры экспорта, а variant
выбирает независимо составленную автором спецификацию; автоматическая оптика
и morph-admission из них не следуют. Несовместимые композиции, raw path,
необъявленные поля, `null` вместо optional values и разреженные массивы имеют
точные отказы. Изменения parser закрепляют эти правила у единственного владельца.

## Проверено

- 45 source-тестов и TypeScript проходят на source freeze.
- Два независимых source reviewer PASS: публичная граница и контракт/последствия
  эволюции. Дополнительно boundary reviewer выполнил 23 самостоятельных probes.
- Literal tutorial и три композиции показаны в Chromium 156 в размерах 16/24/48.
  [Render](public-authoring-20261101.png), SHA-256
  `29347d28273bdcedfc92ff61df598aa4014a2c5944fc626521ad10f51904fe03`.
- 53 bounded проверки release/package fixtures и remote consumer procedure
  проходят после добавления физического authoring export и его деклараций.
  TypeScript, docs drift, repo contract, syntax и diff check проходят.

## Открытый consumer gate

Canonical build и release projection включают только `./authoring` и его точную
private declaration dependency. В remote benchmark job добавлен consumer после
замеров: он исполняет public tutorial из установленного tarball, проверяет
strict NodeNext types с четырьмя отрицательными controls, runtime-отказы,
повторяемость, экспортированный SVG, доступное имя и натуральные размеры.
Готовый SVG bundle содержит только один статический literal input.

Этот remote consumer ещё не выполнялся на срезе. Full build, packed install,
exact-head CI, независимое package review, merge и публикация не считаются
пройденными на основании source-проверок. Новая грамматика не закрывает
prospective author cohort, полный конструктивный корпус или optical admission.
