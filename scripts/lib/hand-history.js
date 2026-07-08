/**
 * scripts/lib/hand-history.js — рука глифа из git-истории (zero-dep).
 *
 * Закон извлечения (прецедент scripts/build-preview.mjs, вынесен в lib для
 * гейтов): «рука» промоутнутого (status:generated) глифа = последняя ревизия
 * файла (git log --follow, переживает переименования), в которой статус
 * варианта в semantics/anatomy.json ТОГО ЖЕ коммита ещё НЕ был generated.
 * Глиф не задекларирован в anatomy той ревизии = рука по построению
 * (корпус рождался рукой). build-preview.mjs — кандидат на переезд на этот
 * lib следующим срезом (сейчас не тронут: минимум конфликтов с параллельной
 * веткой детекторов).
 */

import { execFileSync } from 'node:child_process';

/**
 * @param {string} repo — корень репозитория (cwd git-вызовов)
 */
export function createHandHistory(repo) {
  // stderr — pipe: ожидаемые промахи git show (anatomy.json до своего
  // рождения) ловятся catch-ем и не шумят fatal-строками в вывод гейта.
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  const anatomyAtCache = new Map();
  function anatomyAt(sha) {
    if (!anatomyAtCache.has(sha)) {
      let parsed = null;
      try {
        parsed = JSON.parse(git('show', `${sha}:semantics/anatomy.json`));
      } catch {
        parsed = null; // anatomy.json ещё не существовал ⇒ весь корпус — рука
      }
      anatomyAtCache.set(sha, parsed);
    }
    return anatomyAtCache.get(sha);
  }

  /** Ревизии файла (новые→старые) с путём на момент ревизии. */
  function fileHistory(relPath) {
    const raw = git('log', '--follow', '--format=@%H %cs', '--name-only', '--', relPath);
    const revs = [];
    let cur = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('@')) {
        const [sha, date] = line.slice(1).split(' ');
        cur = { sha, date, path: null };
        revs.push(cur);
      } else if (line.trim() && cur && !cur.path) {
        cur.path = line.trim();
      }
    }
    return revs.filter((r) => r.path);
  }

  /**
   * Последний hand-коммит файла глифа.
   * @returns {{svg:string, sha:string, date:string}|null} null = руки в
   *   истории нет (глиф рождён законом).
   */
  function handFromHistory(relPath, name, variant) {
    for (const rev of fileHistory(relPath)) {
      const status = anatomyAt(rev.sha)?.glyphs?.[name]?.status?.[variant];
      if (status === 'generated') continue;
      try {
        return { svg: git('show', `${rev.sha}:${rev.path}`), sha: rev.sha.slice(0, 7), date: rev.date };
      } catch {
        // ревизия — удаление/переименование без блоба: идём глубже
      }
    }
    return null;
  }

  return { handFromHistory };
}
