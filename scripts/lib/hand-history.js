/**
 * Неизменяемый baseline ручного SVG из git-истории.
 *
 * После промоушена рабочий `svg/**` уже содержит генерат, поэтому сравнение с
 * текущим файлом циклично и ничего не доказывает. Baseline — последняя ревизия
 * того же файла, в которой соответствующий variant ещё не имел
 * `status: generated` в `semantics/anatomy.json`.
 *
 * История используется как переходный SSOT R0. Следующая модель зафиксирует blob
 * SHA в явном baseline manifest; этот helper уже возвращает полный SHA и путь.
 */

import { execFileSync } from 'node:child_process';

function defaultGit(repo, args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * @param {string} repo корень git-репозитория
 * @param {{runGit?:(args:string[])=>string}} options
 */
export function createHandHistory(repo, { runGit = (args) => defaultGit(repo, args) } = {}) {
  const anatomyAtCache = new Map();
  const historyCache = new Map();

  function isShallow() {
    try {
      return runGit(['rev-parse', '--is-shallow-repository']).trim() === 'true';
    } catch {
      return true;
    }
  }

  function anatomyAt(sha) {
    if (!anatomyAtCache.has(sha)) {
      let parsed = null;
      try {
        parsed = JSON.parse(runGit(['show', `${sha}:semantics/anatomy.json`]));
      } catch {
        // До появления конструктивной anatomy весь SVG-корпус был ручным.
        parsed = null;
      }
      anatomyAtCache.set(sha, parsed);
    }
    return anatomyAtCache.get(sha);
  }

  /** Ревизии файла от новых к старым, включая путь после переименований. */
  function fileHistory(relativePath) {
    if (!historyCache.has(relativePath)) {
      const raw = runGit([
        'log',
        '--follow',
        '--format=@%H %cs',
        '--name-only',
        '--',
        relativePath,
      ]);
      const revisions = [];
      let current = null;
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('@')) {
          const [sha, date] = line.slice(1).split(' ');
          current = { sha, date, path: null };
          revisions.push(current);
        } else if (line.trim() && current && !current.path) {
          current.path = line.trim();
        }
      }
      historyCache.set(relativePath, revisions.filter((revision) => revision.path));
    }
    return historyCache.get(relativePath);
  }

  /**
   * @returns {{svg:string,sha:string,shortSha:string,date:string,path:string}|null}
   * null означает, что baseline не доказан доступной историей.
   */
  function handFromHistory(relativePath, name, variant) {
    for (const revision of fileHistory(relativePath)) {
      const status = anatomyAt(revision.sha)?.glyphs?.[name]?.status?.[variant];
      if (status === 'generated') continue;
      try {
        return {
          svg: runGit(['show', `${revision.sha}:${revision.path}`]),
          sha: revision.sha,
          shortSha: revision.sha.slice(0, 7),
          date: revision.date,
          path: revision.path,
        };
      } catch {
        // Ревизия могла быть удалением/переименованием без blob — идём глубже.
      }
    }
    return null;
  }

  return { anatomyAt, fileHistory, handFromHistory, isShallow };
}
