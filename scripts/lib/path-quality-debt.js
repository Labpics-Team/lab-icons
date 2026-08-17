/**
 * scripts/lib/path-quality-debt.js — per-source debt ledger для path quality.
 *
 * Инвариант: ни один source-файл не растёт в находках против своего snapshot.
 * Ключ ledger — имя файла (`Variant/name.svg`), поэтому группировка ОБЯЗАНА
 * канонизировать оба формата находок в один ключ:
 *   «Variant/name.svg: …»           (файловый уровень: швы между path)
 *   «Variant/name.svg слой N: …»    (уровень слоя: микросегменты, изломы)
 * Первая версия ledger группировала по первому «:», из-за чего ключи слоёв
 * («…svg слой 0») никогда не совпадали со snapshot и молча выпадали из
 * сравнения. Регрессия invert_filled это доказала.
 *
 * Closed world: файл с находками, отсутствующий в snapshot, — ошибка, а не
 * молчаливый PASS. Неизвестное = UNKNOWN.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_KEY = /^(.+?\.svg)(?: слой \d+)?:/;

/**
 * Каноническая группировка находок по source-файлу (суффикс «слой N» снят).
 * @param {string[]} findings
 * @returns {Record<string, number>} file -> количество находок
 */
export function findingsByFile(findings) {
  const map = {};
  for (const finding of findings) {
    const match = SOURCE_KEY.exec(finding);
    if (!match) {
      throw new Error(
        `path-quality-debt: находка без канонического file-ключа: ${finding}`,
      );
    }
    map[match[1]] = (map[match[1]] || 0) + 1;
  }
  return map;
}

/**
 * Сравнивает текущие находки с per-source snapshot.
 * Ошибки: рост против baseline, файл вне closed world snapshot и — при
 * переданном allFiles — файл корпуса без ключа в snapshot. Вторая сторона
 * closed world обязательна: удаление ключа «чистого» файла молча выводило
 * бы файл из-под гейта, и будущий долг стал бы невидим.
 *
 * @param {string[]} findings
 * @param {Record<string, number>} snapshot file -> baseline
 * @param {string[]} [allFiles] полный корпус (`Variant/name.svg`)
 * @returns {string[]} ошибки регрессии
 */
export function comparePerSourceDebt(findings, snapshot, allFiles = null) {
  const current = findingsByFile(findings);
  const errors = [];

  if (allFiles) {
    for (const file of allFiles) {
      if (!(file in snapshot)) {
        errors.push(
          `${file}: файла нет в snapshot — closed world обязан покрывать весь корпус`,
        );
      }
    }
  }

  for (const [file, count] of Object.entries(current)) {
    const baseline = snapshot[file];
    if (baseline === undefined) {
      // Closed world: неизвестный файл не может молча пройти с долгом.
      errors.push(
        `${file}: ${count} находок, файла нет в snapshot — closed world нарушен`,
      );
      continue;
    }
    if (count > baseline) {
      errors.push(
        `${file}: ${count} находок (было ${baseline}) — регрессия +${count - baseline}`,
      );
    }
  }

  return errors;
}

/**
 * Загружает per-source snapshot. Отсутствие файла — ошибка контракта, а не
 * пустой ledger: молчаливый {} отключил бы гейт целиком.
 * @param {string} root
 * @returns {Record<string, number>}
 */
export function loadPerSourceSnapshot(root) {
  const path = join(root, 'semantics', 'path-quality-by-source.json');
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(
      `path-quality-debt: snapshot ${path} не читается — ledger обязателен`,
      { cause },
    );
  }
  if (!data || typeof data !== 'object' || !data.byFile || typeof data.byFile !== 'object') {
    throw new Error('path-quality-debt: snapshot обязан иметь объект byFile');
  }
  return data.byFile;
}

/**
 * Строит содержимое snapshot из текущих находок и полного списка файлов
 * корпуса (файлы без находок фиксируются нулём — closed world).
 * @param {string[]} findings
 * @param {string[]} allFiles имена всех source-файлов (`Variant/name.svg`)
 * @param {string} comment provenance-комментарий
 */
export function buildPerSourceSnapshot(findings, allFiles, comment) {
  const counts = findingsByFile(findings);
  const byFile = {};
  for (const file of [...allFiles].sort()) byFile[file] = counts[file] ?? 0;
  for (const file of Object.keys(counts)) {
    if (!(file in byFile)) {
      throw new Error(`path-quality-debt: находка для файла вне корпуса: ${file}`);
    }
  }
  return { version: 1, comment, byFile };
}
