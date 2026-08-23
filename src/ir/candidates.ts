/**
 * Публичный субпат `@labpics/icons/ir/candidates` — opt-in корпус
 * candidate-деклараций (INV-06: default `./ir` несёт только runtime-проекцию).
 *
 * Потребитель, которому нужны исследовательские модели
 * (`glyph({ modelMode: 'allow-candidate' })`), ЯВНО вызывает registerCandidates()
 * один раз при старте; без вызова candidate-построение падает fail-closed
 * ошибкой ядра с указанием этого субпата. Bare-импорт «для эффекта»
 * (`import '@labpics/icons/ir/candidates'`) запрещён как паттерн: модуль
 * не имеет side effects и будет вырезан бандлером (sideEffects: false).
 */
import candidatesJson from '../../semantics/anatomy.candidates.json';
import { registerCandidateAnatomy } from './index.js';

let registered = false;

/** Регистрирует candidate-декларации в ядре. Идемпотентно. */
export function registerCandidates(): void {
  if (registered) return;
  registered = true;
  registerCandidateAnatomy(
    (candidatesJson as { glyphs: Parameters<typeof registerCandidateAnatomy>[0] }).glyphs,
  );
}

