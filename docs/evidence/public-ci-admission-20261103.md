# Публичный CI и организационная группа runners

Прямой GitHub API readback `2026-11-03T01:55:35.7348200Z`:

- `GET /orgs/Labpics-Team/actions/runner-groups`: единственная группа `Default`,
  id `1`, `allows_public_repositories=false`, `visibility=all`,
  `restricted_to_workflows=false`.
- `GET /orgs/Labpics-Team/actions/runners`: 22 runners, 15 online. API вернул
  `os=unknown`; это поле не используется для вывода о доступности native OS.

Публичный `lab-icons` не допускается в эту организационную группу. Число runners
и наличие свободных Linux исполнителей не снимают запрет публичного допуска.
Ранее наблюдавшиеся `queued`/`runner_id=0` сами по себе этой причины не доказывали.

Назначенный заказчиком координатор доставки передал owner readback и решение
`2026-11-03T01:10Z`, mailbox message
`4798c87c-d337-4346-ae21-a36a82e602b4`: публичные Icons проверки выполняются на
стандартных GitHub-hosted Ubuntu/Windows/macOS; расширять public trust boundary
группы запрещено. Приватный Lab UI consumer продолжает использовать self-hosted
runner. Прямой readback выше независимо подтверждает ограничение группы;
источник полномочий для выбора маршрута — поручение координатора.

Workflow сохраняет пять native matrix jobs, security, обязательный browser
benchmark и итог, который отвергает любой результат кроме `success` во всех
трёх зависимостях. `pull_request_target` запрещён безусловно. Успех matrix,
benchmark и review проверяется для новой ревизии; доступность executor не является
их положительным результатом. Тяжёлые проверки на локальном Windows workstation
или sandbox не запускались.
