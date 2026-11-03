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
    'Current package files: 999 byte-for-byte copies of source SVGs.',
    'Current package files: 999 byte-sized SVGs.',
    'Current package files: 999 byte‑sized SVGs.',
    'В текущем пакете файлов: 999 B-вариантов иконок.',
    'В текущем пакете файлов: 999 B‑вариантов иконок.',
    'Current package files: 999 B variants of source SVGs.',
    'Current package files: 999 byte sized SVGs.',
    'Current package **files: 999** **B** variants of source SVGs.',
    'Current package `files: 999` `byte` sized SVGs.',
    'files: 999 B.', 'Количество файлов: 999 bytes.',
    'Size of file: 999 B variants of source SVGs.',
    'Размер файла: 999 байтовых SVG.',
    'Размер файла: 999 byte sized SVGs.',
    'Размер файла: 999 B‑вариантов иконок.',
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

  it('сохраняет явно названное свойство размера файла с байтовой величиной', ({ root }) => {
    mkdirSync(join(root, 'docs/evidence'), { recursive: true });
    const measurements = [
      'Измерен `dist/ir/compiler.js`. Изменились только два фактических baseline поля этого файла: 124013 → 124044 B\nи 37790 → 37801 B gzip.',
      'Размер файла `dist/ir/compiler.js` измерен. Размер файла: **124013** → **124044** B.',
      'Размер файла `dist/ir/compiler.js` измерен. Размер файла: 124044 байта.',
      'Размер файла `dist/ir/compiler.js` измерен. Размер файла: 124044 байтов.',
      'Measured `dist/ir/compiler.js`. Size of file: 124044 bytes.',
      'Measured `dist/ir/compiler.js`. Size of file: 124013 -> 124044 bytes.',
      'Размер compiler файла: 124013 → 124044 B.',
      'Длина файла: 124044 B raw.',
      'Length of this file: 124044 bytes.',
      '| Свойство | Значение |\n| --- | --- |\n| Размер | файла: 124044 B |',
    ];
    for (const file of ['README.md', 'docs/evidence/size.md']) {
      for (const measurement of measurements) {
        writeFileSync(join(root, file), '# Размер\n\n' + measurement);
        expect(auditRepo(root).errors, `${file}: ${measurement}`).toEqual([]);
      }
      writeFileSync(join(root, file), '# Размер\n');
    }
  });

  it('связывает свойство только с его значением, сохраняя соседние счётчики', ({ root }) => {
    mkdirSync(join(root, 'docs/evidence'), { recursive: true });
    const measurement = 'Размер compiler файла: 124013 → 124044 B';
    const controls = [
      ['В текущем пакете файлов: 999, ' + measurement + '.', 'файлов: 999'],
      [measurement + ', в текущем пакете файлов: 999.', 'файлов: 999'],
      [measurement + '; в текущем пакете 999 SVG.', '999 SVG'],
      [measurement + '.\n\nВ текущем пакете 999 icons.', '999 icons'],
      [measurement + ', files: 999 B.', 'files: 999'],
      ['Размер файла измерен, files: 999 B.', 'files: 999'],
      ['Размер файла\n\nфайла: 999 B.', 'файла: 999'],
      ['| Свойство | Значение |\n| --- | --- |\n| Размер | файла: 124044 B |\n| Корпус | files: 999 B |', 'files: 999'],
    ];
    for (const file of ['README.md', 'docs/evidence/size.md']) {
      for (const [source, claim] of controls) {
        writeFileSync(join(root, file), '# Размер и корпус\n\n' + source);
        const errors = auditRepo(root).errors.filter(error => error.includes('ручной счётчик'));
        expect(errors, `${file}: ${source}`).toHaveLength(1);
        expect(errors[0], `${file}: ${source}`).toContain(`«${claim}»`);
      }
      writeFileSync(join(root, file), '# Размер и корпус\n');
    }
  });

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
