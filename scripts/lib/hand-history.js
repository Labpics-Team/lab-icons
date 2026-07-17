/**
 * Неизменяемый baseline ручного SVG из git-истории.
 *
 * После промоушена рабочий `svg/**` уже содержит генерат, поэтому сравнение с
 * текущим файлом циклично и ничего не доказывает. Baseline — последняя ревизия
 * того же файла, в которой соответствующий variant ещё не имел
 * `status: generated` в `semantics/anatomy.json`.
 *
 * История — переходный R0 SSOT. Helper возвращает и commit SHA, и blob SHA:
 * commit объясняет момент решения, blob однозначно идентифицирует байты руки и
 * впоследствии переносится в явный baseline manifest без смены семантики.
 */

import { execFileSync } from 'node:child_process';

const VARIANTS = new Set(['outline', 'filled']);
const SHA40 = /^[0-9a-f]{40}$/;
const LS_TREE_LINE = /^(\d+)\s+blob\s+([0-9a-f]{40})\t(.+)$/;
const NAME_STATUS_LINE = /^([A-Z])(\d{1,3})?\t([^\t]+)(?:\t([^\t]+))?$/;

function defaultGit(repo, args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('hand-history: relativePath обязан быть непустой строкой');
  }
  if (relativePath.startsWith('/') || relativePath.includes('\\')) {
    throw new Error(`hand-history: ожидается repo-relative POSIX path; найдено ${relativePath}`);
  }
  if (relativePath.split('/').includes('..')) {
    throw new Error(`hand-history: выход за корень запрещён (${relativePath})`);
  }
}

/**
 * @param {string} repo корень git-репозитория
 * @param {{runGit?:(args:string[])=>string}} options
 */
export function createHandHistory(repo, { runGit = (args) => defaultGit(repo, args) } = {}) {
  const anatomyAtCache = new Map();
  const historyCache = new Map();
  const treeEntryCache = new Map();
  const blobCache = new Map();

  function isShallow() {
    return runGit(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  }

  /**
   * Точный blob одного пути в дереве. Пустой stdout = пути в ревизии нет;
   * ошибка git НЕ проглатывается и не превращается в «файл ещё не существовал».
   */
  function treeEntryAt(commitSha, relativePath) {
    if (!SHA40.test(commitSha)) {
      throw new Error(`hand-history: невалидный commit SHA ${String(commitSha)}`);
    }
    assertRelativePath(relativePath);
    const key = `${commitSha}:${relativePath}`;
    if (!treeEntryCache.has(key)) {
      const raw = runGit(['ls-tree', '-r', commitSha, '--', relativePath]).trim();
      if (raw === '') {
        treeEntryCache.set(key, null);
      } else {
        const entries = raw.split(/\r?\n/).filter(Boolean);
        if (entries.length !== 1) {
          throw new Error(
            `hand-history: ${key} обязан разрешаться в один blob; найдено ${entries.length}`,
          );
        }
        const match = entries[0].match(LS_TREE_LINE);
        if (!match || match[3] !== relativePath) {
          throw new Error(`hand-history: неожиданный ls-tree для ${key}: ${entries[0]}`);
        }
        treeEntryCache.set(key, {
          mode: match[1],
          blobSha: match[2],
          path: match[3],
        });
      }
    }
    return treeEntryCache.get(key);
  }

  function fileAt(commitSha, relativePath) {
    const entry = treeEntryAt(commitSha, relativePath);
    if (!entry) return null;
    if (!blobCache.has(entry.blobSha)) {
      // Читаем по blob SHA, а не по `commit:path`: provenance и содержимое
      // связаны одной проверенной сущностью, rename больше не влияет на байты.
      blobCache.set(entry.blobSha, runGit(['cat-file', 'blob', entry.blobSha]));
    }
    return { ...entry, content: blobCache.get(entry.blobSha) };
  }

  function anatomyAt(commitSha) {
    if (!anatomyAtCache.has(commitSha)) {
      const snapshot = fileAt(commitSha, 'semantics/anatomy.json');
      if (!snapshot) {
        // До появления конструктивной anatomy весь SVG-корпус был ручным.
        anatomyAtCache.set(commitSha, null);
      } else {
        try {
          const parsed = JSON.parse(snapshot.content);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
              !parsed.glyphs || typeof parsed.glyphs !== 'object' || Array.isArray(parsed.glyphs)) {
            throw new Error('ожидался объект с glyphs');
          }
          anatomyAtCache.set(commitSha, parsed);
        } catch (error) {
          throw new Error(
            `hand-history: semantics/anatomy.json@${commitSha.slice(0, 7)} невалиден (${error.message})`,
          );
        }
      }
    }
    return anatomyAtCache.get(commitSha);
  }

  /** Ревизии файла от новых к старым, включая путь после переименований. */
  function fileHistory(relativePath) {
    assertRelativePath(relativePath);
    if (!historyCache.has(relativePath)) {
      const raw = runGit([
        'log',
        '--follow',
        '--format=@%H%x09%cs',
        '--name-status',
        '--',
        relativePath,
      ]);
      const revisions = [];
      let current = null;
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('@')) {
          const match = line.match(/^@([0-9a-f]{40})\t(\d{4}-\d{2}-\d{2})$/);
          if (!match) throw new Error(`hand-history: неожиданный заголовок git log: ${line}`);
          current = { commitSha: match[1], date: match[2], path: null, change: null };
          revisions.push(current);
          continue;
        }
        if (!line.trim()) continue;
        if (!current) throw new Error(`hand-history: name-status вне commit-блока: ${line}`);

        const change = line.match(NAME_STATUS_LINE);
        if (!change) throw new Error(`hand-history: неожиданный name-status: ${line}`);
        const kind = change[1];
        const path = kind === 'R' || kind === 'C' ? change[4] : change[3];
        if (!path) throw new Error(`hand-history: ${kind}-запись не несёт конечный путь: ${line}`);
        assertRelativePath(path);
        if (current.path && current.path !== path) {
          throw new Error(
            `hand-history: одна ревизия дала несколько путей (${current.path}, ${path})`,
          );
        }
        current.path = path;
        current.change = kind;
      }
      historyCache.set(
        relativePath,
        revisions.filter((revision) => revision.path !== null),
      );
    }
    return historyCache.get(relativePath);
  }

  /**
   * @returns {{svg:string,commitSha:string,shortCommitSha:string,blobSha:string,date:string,path:string}|null}
   * null означает только «доказанного hand blob нет в доступной полной истории».
   * Git/JSON/форматные ошибки выбрасываются и обязаны покрасить вызывающий гейт.
   */
  function handFromHistory(relativePath, name, variant) {
    assertRelativePath(relativePath);
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('hand-history: name обязан быть непустой строкой');
    }
    if (!VARIANTS.has(variant)) {
      throw new Error(`hand-history: неизвестный variant ${String(variant)}`);
    }

    for (const revision of fileHistory(relativePath)) {
      const anatomy = anatomyAt(revision.commitSha);
      const statuses = anatomy?.glyphs?.[name]?.status;
      const hasStatus = statuses && Object.prototype.hasOwnProperty.call(statuses, variant);
      const status = hasStatus ? statuses[variant] : undefined;
      if (status === 'generated') continue;
      if (hasStatus && status !== 'hand') {
        throw new Error(
          `hand-history: ${name}/${variant}@${revision.commitSha.slice(0, 7)} ` +
            `имеет неизвестный status ${JSON.stringify(status)}`,
        );
      }

      const file = fileAt(revision.commitSha, revision.path);
      if (!file) {
        // Commit мог быть удалением/rename boundary без blob по показанному пути.
        continue;
      }
      return {
        svg: file.content,
        commitSha: revision.commitSha,
        shortCommitSha: revision.commitSha.slice(0, 7),
        blobSha: file.blobSha,
        date: revision.date,
        path: file.path,
      };
    }
    return null;
  }

  return {
    anatomyAt,
    fileAt,
    fileHistory,
    handFromHistory,
    isShallow,
    treeEntryAt,
  };
}
