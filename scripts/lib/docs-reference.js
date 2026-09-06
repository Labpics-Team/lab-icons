/** Справка о поставке — представление уже проверенных package/release contracts. */
export function renderPackageReference(pkg, contract) {
  const imports = Object.entries(contract.exports).map(([subpath, conditions]) => {
    const name = subpath === '.' ? contract.packageName : contract.packageName + subpath.slice(1);
    return `| \`${name}\` | \`${conditions.import}\` | \`${conditions.types}\` |`;
  });
  const fallback = contract.fallback.specifier.replace('vX.Y.Z', `v${pkg.version}`);
  return [
    '# Поставка пакета — справка',
    '',
    '<!-- Сгенерировано scripts/check-docs-drift.js --write. Не редактировать вручную. -->',
    '',
    'Источники: [контракт поставки](../release/contract.json) и [метаданные пакета](../package.json).',
    'Эта справка описывает checkout, а не подтверждает публикацию версии в реестре.',
    '',
    '## Установка',
    '',
    `Пакет: \`${contract.packageName}\`. Версия checkout: \`${pkg.version}\`.`,
    '',
    'Основной канал — публичный npm:',
    '',
    '```sh',
    contract.primary.install,
    '```',
    '',
    'Альтернативная ссылка на неизменяемый артефактный тег:',
    '',
    '```json',
    JSON.stringify({ dependencies: { [contract.packageName]: fallback } }, null, 2),
    '```',
    '',
    '## Среда разработки',
    '',
    `Менеджер пакетов: \`${pkg.packageManager}\`.`,
    '',
    '| Среда | Ограничение |',
    '|---|---|',
    ...Object.entries(pkg.engines).map(([name, range]) => `| \`${name}\` | \`${range}\` |`),
    '',
    '## Точки входа',
    '',
    '| Импорт | JavaScript | Типы |',
    '|---|---|---|',
    ...imports,
    '',
    '## Файлы контракта поставки',
    '',
    'Список ниже не включает автоматически добавляемые npm метаданные.',
    'Полный упакованный артефакт проверяет `pnpm check:package-artifact`.',
    '',
    ...contract.files.map((file) => `- \`${file}\``),
    '',
    '## Транзитивные декларации типов',
    '',
    ...contract.typeDependencies.map((file) => `- \`${file}\``),
    '',
  ].join('\n');
}

/** Сравнивается весь документ: дополнительная противоречащая строка тоже даёт ошибку. */
export function packageReferenceErrors(actual, pkg, contract) {
  return actual.replace(/\r\n/g, '\n') === renderPackageReference(pkg, contract)
    ? []
    : ['docs/package.md не совпадает с проекцией контрактов; выполните node scripts/check-docs-drift.js --write'];
}
