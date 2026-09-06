# Поставка пакета — справка

<!-- Сгенерировано scripts/check-docs-drift.js --write. Не редактировать вручную. -->

Источники: [контракт поставки](../release/contract.json) и [метаданные пакета](../package.json).
Эта справка описывает checkout, а не подтверждает публикацию версии в реестре.

## Установка

Пакет: `@labpics/icons`. Версия checkout: `0.3.0`.

Основной канал — публичный npm:

```sh
pnpm add @labpics/icons
```

Альтернативная ссылка на неизменяемый артефактный тег:

```json
{
  "dependencies": {
    "@labpics/icons": "github:Labpics-Team/lab-icons#v0.3.0-dist"
  }
}
```

## Среда разработки

Менеджер пакетов: `pnpm@11.13.1`.

| Среда | Ограничение |
|---|---|
| `node` | `>=22.14.0` |
| `pnpm` | `>=11.13.1` |

## Точки входа

| Импорт | JavaScript | Типы |
|---|---|---|
| `@labpics/icons` | `./dist/index.js` | `./dist/index.d.ts` |
| `@labpics/icons/ir` | `./dist/ir/index.js` | `./dist/ir/index.d.ts` |
| `@labpics/icons/ir/recipes` | `./dist/ir/recipes.js` | `./dist/ir/recipes.d.ts` |
| `@labpics/icons/ir/candidates` | `./dist/ir/candidates.js` | `./dist/ir/candidates.d.ts` |

## Файлы контракта поставки

Список ниже не включает автоматически добавляемые npm метаданные.
Полный упакованный артефакт проверяет `pnpm check:package-artifact`.

- `dist/index.d.ts`
- `dist/index.js`
- `dist/ir/candidates.d.ts`
- `dist/ir/candidates.js`
- `dist/ir/catalog.generated.d.ts`
- `dist/ir/index.d.ts`
- `dist/ir/index.js`
- `dist/ir/recipes.d.ts`
- `dist/ir/recipes.js`

## Транзитивные декларации типов

- `dist/ir/catalog.generated.d.ts`
