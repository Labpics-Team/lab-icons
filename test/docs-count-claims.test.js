import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, auditRepo } from '../scripts/check-docs-drift.js';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'icons-count-claim-'));
  try {
    mkdirSync(join(root, 'docs'));
    mkdirSync(join(root, 'release'));
    for (const path of ['package.json', 'release/contract.json', 'docs/package.md']) {
      cpSync(join(ROOT, path), join(root, path));
    }
    writeFileSync(join(root, 'README.md'), '# Иконки\n');
    expect(auditRepo(root).errors).toEqual([]);
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('ручные счётчики не становятся вторым источником корпуса', () => {
  const claims = [
    '999 иконок', '**999**\nSVG', '999 именованных ESM-экспортов',
    'SVG: 999', 'Количество иконок: **999**', 'ровно семь release-файлов',
    '238 имён', '476 SVG', '999 icons', 'one icon', 'nine icons', 'ten SVG files',
    'одиннадцать иконок', 'двенадцать SVG', 'сто иконок', 'двухсот глифов',
    'две тысячи иконок', 'один миллион иконок', 'дюжина иконок',
    'eleven icons', 'one hundred and eleven icons', 'two thousand SVG files',
    'one million exports', 'a dozen icons',
  ];
  for (const claim of claims) {
    it(`отклоняет даже случайно верный ручной счётчик: ${claim}`, () => fixture((root) => {
      mkdirSync(join(root, 'docs/reference'), { recursive: true });
      for (const file of ['README.md', 'docs/reference/corpus.md']) {
        writeFileSync(join(root, file), '# Корпус\n\n' + claim);
        expect(auditRepo(root).errors.some((error) => error.replaceAll('\\', '/').includes(file) && error.includes('ручной счётчик'))).toBe(true);
        writeFileSync(join(root, file), '# Корпус\n');
      }
    }));
  }

  it('сохраняет параметры геометрии и не принимает произвольное слово за число', () => fixture((root) => {
    writeFileSync(join(root, 'docs/geometry.md'), [
      '# Геометрия',
      '',
      'Размер 24 px. Отдельный contour ID, API и JSON не являются счётчиком.',
      'Публичные exports описаны в справке поставки; статические icons используют currentColor.',
    ].join('\n'));
    expect(auditRepo(root).errors).toEqual([]);
  }));
});
