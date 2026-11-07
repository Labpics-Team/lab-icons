import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
let root;
const generate = (...args) => execFileSync(process.execPath,
  [join(root, 'scripts/census/build-census.mjs'), ...args], { encoding: 'utf8' });
const check = () => spawnSync(process.execPath, [join(root, 'scripts/check-census-fresh.js')], { encoding: 'utf8' });
const census = () => readFileSync(join(root, 'semantics/census.json'), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lab-icons-census-'));
  for (const dir of ['scripts/census', 'src/core', 'semantics', 'dist/ir']) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ['scripts/census/build-census.mjs', 'scripts/check-census-fresh.js', 'src/core/path-data.js']) {
    copyFileSync(join(sourceRoot, file), join(root, file));
  }
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'semantics/catalog.json'), '{"icons":{"plain":{}}}');
  writeFileSync(join(root, 'semantics/anatomy.json'), '{"glyphs":{}}');
  writeFileSync(join(root, 'semantics/census.json'), 'unchanged sentinel\n');
  writeFileSync(join(root, 'dist/index.js'), 'export const plain = "<svg/>";\n');
  writeFileSync(join(root, 'dist/ir/index.js'), '// src/first.js\nexport const plain = "Микрофон";\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('Свежесть census без изменения проверяемого файла', () => {
  it('возвращает только JSON и те же bytes, что обычная генерация', () => {
    const expected = generate('--stdout');
    expect(census()).toBe('unchanged sentinel\n');
    expect(JSON.parse(expected)).toMatchObject({ sourceOnlyCount: 1, modeledCount: 0 });
    const irBytes = readFileSync(join(root, 'dist/ir/index.js')).length;
    expect(JSON.parse(expected).bundle.totalBytes).toBe(irBytes);
    expect(JSON.parse(expected).bundle.modules[0].bytes).toBe(irBytes);
    expect(JSON.parse(expected).consumerBudgets.glyphRuntime.raw).toBe(irBytes);
    generate();
    expect(census()).toBe(expected);
    expect(check().status).toBe(0);
    expect(census()).toBe(expected);
  });

  it('отклоняет stale projection и отдаёт точную генерацию, сохраняя прежний файл', () => {
    generate();
    const committed = census();
    writeFileSync(join(root, 'dist/ir/index.js'), '// src/changed.js\nexport const plain = 22;\n');
    const expected = generate('--stdout');
    const result = check();
    expect(result.status).toBe(1);
    expect(census()).toBe(committed);
    const line = result.stderr.split('\n').find(line => line.startsWith('check-census-fresh: GENERATED_JSON '));
    const receipt = JSON.parse(line.slice('check-census-fresh: GENERATED_JSON '.length));
    expect(Buffer.from(receipt.base64, 'base64').toString('utf8')).toBe(expected);
    expect(receipt.sha256).toBe(createHash('sha256').update(expected).digest('hex'));
  });

  it('не подменяет отсутствующую сборку старым census', () => {
    rmSync(join(root, 'dist/ir/index.js'));
    const result = check();
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('GENERATED_JSON');
    expect(census()).toBe('unchanged sentinel\n');
  });

  it('отклоняет повреждение UTF-8 при одинаковом декодированном тексте', () => {
    writeFileSync(join(root, 'dist/ir/index.js'), '// src/\uFFFD.js\nexport const plain = 1;\n');
    generate();
    const expected = readFileSync(join(root, 'semantics/census.json'));
    const offset = expected.indexOf(Buffer.from('\uFFFD'));
    expect(offset).toBeGreaterThanOrEqual(0);
    const corrupt = Buffer.concat([expected.subarray(0, offset), Buffer.from([0xff]), expected.subarray(offset + 3)]);
    expect(corrupt.toString('utf8')).toBe(expected.toString('utf8'));
    expect(corrupt.equals(expected)).toBe(false);
    writeFileSync(join(root, 'semantics/census.json'), corrupt);
    expect(check().status).toBe(1);
    expect(readFileSync(join(root, 'semantics/census.json')).equals(corrupt)).toBe(true);
  });

  it('отклоняет неизвестный режим до записи projection', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/census/build-census.mjs'), '--unknown'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(census()).toBe('unchanged sentinel\n');
  });
});
