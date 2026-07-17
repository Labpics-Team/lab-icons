import { existsSync, renameSync, rmSync } from 'node:fs';

const DEFAULT_FS = Object.freeze({ existsSync, renameSync, rmSync });

function assertDistinctPaths(staging, output, backup) {
  if (!staging || !output || !backup || new Set([staging, output, backup]).size !== 3) {
    throw new TypeError('owned directory transaction требует три разных непустых пути');
  }
}

/**
 * Восстанавливает единственное однозначное crash-состояние предыдущей замены.
 *
 * backup без output означает остановку между двумя rename: старый валидный
 * output возвращается. Одновременные output + backup означают, что новый
 * output уже установлен, а процесс не успел удалить прежний.
 */
export function recoverOwnedDirectory({ output, backup, fs = DEFAULT_FS }) {
  if (!output || !backup || output === backup) {
    throw new TypeError('owned directory recovery требует два разных непустых пути');
  }
  if (!fs.existsSync(backup)) return 'clean';
  if (fs.existsSync(output)) {
    fs.rmSync(backup, { recursive: true, force: true });
    return 'committed';
  }
  fs.renameSync(backup, output);
  return 'rolled-back';
}

/**
 * Транзакционно заменяет owned directory после того, как staging доказан.
 * Любая синхронная ошибка второго rename восстанавливает прежний output.
 * Crash между rename чинится recoverOwnedDirectory при следующем запуске.
 */
export function replaceOwnedDirectory({ staging, output, backup, fs = DEFAULT_FS }) {
  assertDistinctPaths(staging, output, backup);
  recoverOwnedDirectory({ output, backup, fs });

  const hadOutput = fs.existsSync(output);
  if (hadOutput) fs.renameSync(output, backup);
  try {
    fs.renameSync(staging, output);
  } catch (error) {
    if (hadOutput && fs.existsSync(backup) && !fs.existsSync(output)) {
      fs.renameSync(backup, output);
    }
    throw error;
  }

  if (fs.existsSync(backup)) {
    fs.rmSync(backup, { recursive: true, force: true });
  }
}
