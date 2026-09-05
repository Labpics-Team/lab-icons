import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, auditRepo, distributionClaimErrors, findInkHexClaims, writePackageReference } from '../scripts/check-docs-drift.js';
import { packageReferenceErrors, renderPackageReference } from '../scripts/lib/docs-reference.js';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const contract = JSON.parse(readFileSync(join(ROOT, 'release/contract.json'), 'utf8'));
const reference = readFileSync(join(ROOT, 'docs/package.md'), 'utf8').replace(/\r\n/g, '\n');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-docs-'));
  try {
    mkdirSync(join(root, 'docs'));
    mkdirSync(join(root, 'release'));
    for (const path of ['package.json', 'release/contract.json', 'README.md', 'docs/package.md']) {
      cpSync(join(ROOT, path), join(root, path));
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('справка поставки из единственного контракта', () => {
  it('проверяет весь документ, а не присутствие правильного числа', () => {
    expect(packageReferenceErrors(reference, pkg, contract)).toEqual([]);
    expect(packageReferenceErrors(reference + '\nВсего семь файлов.\n', pkg, contract)).toHaveLength(1);
    expect(packageReferenceErrors('', pkg, contract)).toHaveLength(1);
  });

  it('сохраняет все import/type targets и файлы, включая транзитивные типы', () => {
    for (const [subpath, conditions] of Object.entries(contract.exports)) {
      const name = subpath === '.' ? pkg.name : pkg.name + subpath.slice(1);
      expect(reference).toContain(`| \`${name}\` | \`${conditions.import}\` | \`${conditions.types}\` |`);
      expect(packageReferenceErrors(reference.replace(conditions.import, './dist/missing.js'), pkg, contract)).toHaveLength(1);
    }
    const fileSection = reference.split('## Файлы контракта поставки\n')[1].split('## Транзитивные')[0];
    const files = [...fileSection.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(files).toEqual(contract.files);
  });

  it('изменение источника инвалидирует прежнюю проекцию', () => {
    const next = structuredClone(contract);
    next.exports['./ir'].import = './dist/ir/replacement.js';
    expect(packageReferenceErrors(reference, pkg, next)).toHaveLength(1);
    expect(renderPackageReference(pkg, next)).toContain('./dist/ir/replacement.js');
    expect(packageReferenceErrors(reference, { ...pkg, version: '99.0.0' }, contract)).toHaveLength(1);
    expect(packageReferenceErrors(reference, { ...pkg, engines: { ...pkg.engines, node: '>=99' } }, contract)).toHaveLength(1);
  });

  it('повтор генерации детерминирован; CRLF checkout не является дрейфом', () => {
    expect(renderPackageReference(pkg, contract)).toBe(renderPackageReference(pkg, contract));
    expect(packageReferenceErrors(reference.replace(/\n/g, '\r\n'), pkg, contract)).toEqual([]);
  });
});

describe('проверяемая граница утверждений', () => {
  it('сохраняет защиту npm channel, включая переносы и Markdown', () => {
    for (const text of ['private: true', 'Пакет не **публикуется**\nв `npm`', 'Ставится только как git-зависимость', 'Нужен GH_PAT']) {
      expect(distributionClaimErrors(text).length).toBeGreaterThan(0);
    }
    expect(distributionClaimErrors('Основной канал — npm. Публикацию конкретной версии проверяют отдельно.')).toEqual([]);
  });

  it('фиксированные чернила не подменяют currentColor', () => {
    expect(findInkHexClaims('Моно-чернила #101012')).toHaveLength(1);
    expect(findInkHexClaims('чернила наследуют currentColor')).toEqual([]);
  });

  it('обходит вложенные документы и называет конкретный файл', () => fixture((root) => {
    expect(auditRepo(root).errors).toEqual([]);
    mkdirSync(join(root, 'docs/reference/deep'), { recursive: true });
    writeFileSync(join(root, 'docs/reference/deep/install.md'), 'Пакет не публикуется в npm.');
    expect(auditRepo(root).errors.some((error) => error.includes('install.md'))).toBe(true);
  }));

  it('сессионные handoffs не становятся вечной инструкцией после merge', () => fixture((root) => {
    expect(auditRepo(root).errors).toEqual([]);
    writeFileSync(join(root, 'WAVE7-HANDOFF.md'), 'Статус: выполнено');
    expect(auditRepo(root).errors.some((error) => error.includes('WAVE7-HANDOFF.md'))).toBe(true);
    unlinkSync(join(root, 'WAVE7-HANDOFF.md'));
    mkdirSync(join(root, 'handoffs'));
    writeFileSync(join(root, 'handoffs/WAVE7-HANDOFF.md'), 'Статус: выполнено');
    expect(auditRepo(root).errors.some((error) => error.includes('handoffs/'))).toBe(true);
  }));

  it('отсутствующая справка не даёт пустого успеха', () => fixture((root) => {
    unlinkSync(join(root, 'docs/package.md'));
    expect(auditRepo(root).errors).toContain('отсутствует docs/package.md');
  }));

  it('некорректный источник не исправляется правкой справки', () => fixture((root) => {
    const broken = { ...contract, files: [] };
    writeFileSync(join(root, 'release/contract.json'), JSON.stringify(broken));
    expect(auditRepo(root).errors.length).toBeGreaterThan(0);
    expect(() => writePackageReference(root)).toThrow();
    expect(readFileSync(join(root, 'docs/package.md'), 'utf8').replace(/\r\n/g, '\n')).toBe(reference);
  }));

  it('явная регенерация меняет только производный документ', () => fixture((root) => {
    const beforePackage = readFileSync(join(root, 'package.json'), 'utf8');
    const beforeContract = readFileSync(join(root, 'release/contract.json'), 'utf8');
    writeFileSync(join(root, 'docs/package.md'), 'испорченная проекция');
    expect(auditRepo(root).errors.length).toBeGreaterThan(0);
    writePackageReference(root);
    expect(auditRepo(root).errors).toEqual([]);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(beforePackage);
    expect(readFileSync(join(root, 'release/contract.json'), 'utf8')).toBe(beforeContract);
    writePackageReference(root);
    expect(readFileSync(join(root, 'docs/package.md'), 'utf8').replace(/\r\n/g, '\n')).toBe(reference.replace(/\r\n/g, '\n'));
  }));
});

it('актуальный checkout проходит заявленные проверки документации', () => {
  expect(auditRepo(ROOT).errors).toEqual([]);
});
