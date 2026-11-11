/**
 * check-adjacency-cli.test.js — контракт CLI-процесса гейта (exit-коды и каналы).
 *
 * Почему отдельно от юнитов: verify-цепь и CI зовут гейт как ПРОЦЕСС, и его
 * контракт — это exit-код + канал вывода, а не возврат функции. Юниты это не
 * покрывают: регрессия «FAIL печатается, но exit 0» или «ошибки уходят в stdout»
 * прошла бы мимо них и молча позеленила сломанный CI.
 *
 * Контракт: успех → exit 0 (отчёт в stdout, stderr пуст); дефект → exit 1,
 * причина в stderr; ошибка использования (нет такого глифа) → exit 2 в stderr.
 * Проверяем на лёгких фикстурах {hand,parts} — без корпусного прогона, чтобы
 * не дублировать тяжёлый путь, который verify уже гоняет без аргументов.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cli = join(root, 'scripts', 'check-adjacency.js');
const fx = (n) => join(here, 'fixtures', 'adjacency', n);

const run = (...args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });

describe('check-adjacency CLI — exit-коды и каналы вывода', () => {
  it('успех (перекрытая фикстура) → exit 0, отчёт в stdout, stderr пуст', () => {
    const r = run(fx('overlap.json'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK');
    expect(r.stderr.trim()).toBe('');
  });

  it('дефект (разорванная фикстура) → exit 1, причина в stderr', () => {
    const r = run(fx('gap.json'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAIL');
    expect(r.stderr).toContain('разрыв');
    // stdout — не канал ошибок: FAIL туда не дублируется
    expect(r.stdout).not.toContain('FAIL');
  });

  it('ошибка использования (неизвестный глиф) → exit 2, сообщение в stderr', () => {
    const r = run('нет-такого-глифа');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('нет глифа');
  });

  it('смешанные цели: хоть один дефект → exit 1 (ошибка не маскируется успехом соседа)', () => {
    const r = run(fx('overlap.json'), fx('gap.json'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAIL');
  });
});
