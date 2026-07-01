# @labpics/icons

Библиотека иконок Labpics. 444 SVG: 222 Filled + 222 Outline.

## Установка

Пакет публикуется в **GitHub Packages** (npm-регистри `npm.pkg.github.com`), а не в
публичном npm. Репозиторий приватный — значит и пакет приватный: для установки нужно
(1) направить scope `@labpics` на регистри GitHub Packages и (2) аутентифицироваться
токеном со scope `read:packages`.

**Шаг 1 — `.npmrc` в проекте-потребителе** (маппинг scope → регистри):

```ini
@labpics:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

**Шаг 2 — аутентификация** (токен только в переменной окружения, НИКОГДА в git):

- **В CI (GitHub Actions):** встроенный `GITHUB_TOKEN` с правом `packages: read` —
  ничего создавать не нужно:

  ```yaml
  permissions:
    packages: read
  # ...
  - uses: actions/setup-node@... # тот же пин, что в ci.yml
    with:
      node-version: '20'
      registry-url: 'https://npm.pkg.github.com'
      scope: '@labpics'
  - run: pnpm install --frozen-lockfile
    env:
      NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```

- **Локально:** Personal Access Token (classic) со scope `read:packages`, прокинутый
  через переменную окружения `NODE_AUTH_TOKEN` (в Labpics организационный
  `read:packages` токен хранится в Infisical как SSOT — не хардкодь и не коммить его):

  ```bash
  export NODE_AUTH_TOKEN=<PAT c read:packages>
  pnpm add @labpics/icons
  ```

## Структура

```
svg/
  Filled/   — 222 иконки (*_filled.svg)
  Outline/  — 222 иконки (*.svg)
svgo.config.cjs — конфиг оптимизации (currentColor, 24×24 viewBox)
```

## Конвенция имён

| Вариант | Файл                       | Экспорт                |
|---------|----------------------------|------------------------|
| Filled  | `accessibility_filled.svg` | `accessibilityFilled`  |
| Outline | `accessibility.svg`        | `accessibilityOutline` |

## Как собрать

```bash
pnpm install
pnpm build       # svgo-оптимизация + генерация dist/index.js + dist/index.d.ts
```

## Как потреблять

```ts
import { accessibilityFilled, accessibilityOutline } from '@labpics/icons'
```

Только используемые иконки попадают в бандл (tree-shaking через `sideEffects: false`).

## Инварианты

- Нет runtime-зависимостей (`dependencies: {}`)
- Каждый SVG — `currentColor`, `viewBox="0 0 24 24"`
- 222 имён × 2 варианта = 444 экспорта; несоответствие → ненулевой exit билда
