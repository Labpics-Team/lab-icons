import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { it } from './fixtures/documentation.js';
import { auditRepo } from '../scripts/check-docs-drift.js';

describe('Ручные счётчики в документации', () => {
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
    it(`отклоняет ручной счётчик: ${claim}`, ({ root }) => {
      mkdirSync(join(root, 'docs/reference'), { recursive: true });
      for (const file of ['README.md', 'docs/reference/corpus.md']) {
        writeFileSync(join(root, file), '# Корпус\n\n' + claim);
        expect(auditRepo(root).errors.some((error) => error.replaceAll('\\', '/').includes(file) && error.includes('ручной счётчик'))).toBe(true);
        writeFileSync(join(root, file), '# Корпус\n');
      }
    });
  }

  it('сохраняет параметры геометрии и названия API', ({ root }) => {
    writeFileSync(join(root, 'docs/geometry.md'), [
      '# Геометрия',
      '',
      'Размер 24 px. Отдельный contour ID, API и JSON не являются счётчиком.',
      'Публичные exports описаны в справке поставки; статические icons используют currentColor.',
    ].join('\n'));
    expect(auditRepo(root).errors).toEqual([]);
  });
});
