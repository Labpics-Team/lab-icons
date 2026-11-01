import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { buildIr } from '../scripts/build-ir.mjs';

vi.mock('esbuild', async importOriginal => ({ ...await importOriginal(), build: vi.fn() }));

const roots = [];
const TARGET_FILES = { ir: 'index', symbols: 'example', motion: 'index' };
const STATIC_FILES = {
  'index.js': 'export const staticIcon = "preserved";\n',
  'index.d.ts': 'export declare const staticIcon: "preserved";\n',
  'svg/Outline/example.svg': '<svg><path d="M1 1H2V2Z"/></svg>',
  'anatomy.json': '{"static":"preserved"}',
  'catalog.json': '{"catalog":"preserved"}',
};
const BUILD_MODULE = new URL('../scripts/build-ir.mjs', import.meta.url).href;

function write(root, path, value) {
  fs.mkdirSync(dirname(join(root, path)), { recursive: true });
  fs.writeFileSync(join(root, path), value);
}

function writeTargets(staging, epoch = 'new') {
  for (const [target, file] of Object.entries(TARGET_FILES)) {
    write(staging, `${target}/${file}.js`, `export const epoch = "${epoch}";\n`);
    write(staging, `${target}/${file}.d.ts`, `export declare const epoch: "${epoch}";\n`);
  }
  return 1;
}

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'lab-icons-build-publication-'));
  roots.push(root);
  const output = join(root, 'dist');
  for (const [path, value] of Object.entries(STATIC_FILES)) write(output, path, value);
  writeTargets(output, 'old');
  const exports = { '.': { types: './dist/index.d.ts', import: './dist/index.js' } };
  for (const [target, file] of Object.entries(TARGET_FILES)) {
    exports[`./${target}`] = { types: `./dist/${target}/${file}.d.ts`, import: `./dist/${target}/${file}.js` };
  }
  const contract = { packageName: '@labpics/icons', exports, runtimeDependencies: [], typeDependencies: [],
    files: ['dist/index.js', 'dist/index.d.ts', ...Object.entries(TARGET_FILES).flatMap(([target, file]) =>
      [`dist/${target}/${file}.js`, `dist/${target}/${file}.d.ts`])].sort() };
  write(root, 'release/contract.json', JSON.stringify(contract));
  return { root, output, backup: join(root, '.dist-ir-previous') };
}

function epochs(output) {
  return Object.entries(TARGET_FILES).map(([target, file]) =>
    /epoch = "([^"]+)"/.exec(fs.readFileSync(join(output, target, `${file}.js`), 'utf8'))[1]);
}

function expectStatic(output) {
  for (const [path, value] of Object.entries(STATIC_FILES)) expect(fs.readFileSync(join(output, path), 'utf8')).toBe(value);
}

function expectNoTransactionFiles(root) {
  expect(fs.readdirSync(root).filter(name => name.startsWith('.dist-ir-'))).toEqual([]);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert(basename(root).startsWith('lab-icons-build-publication-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('публикация единой эпохи IR/symbols/motion', () => {
  it.each(['exit', 'kill'])('после настоящего process crash %s следующий build убирает только abandoned staging', async mode => {
    const { root, output } = fixture();
    const script = `
      import { buildIr } from ${JSON.stringify(BUILD_MODULE)};
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      await buildIr({ root: ${JSON.stringify(root)}, compileTargets({ staging }) {
        mkdirSync(join(staging, 'ir'));
        writeFileSync(join(staging, 'ir/index.js'), 'partial crash output');
        ${mode === 'exit' ? 'process.exit(17)' : "process.kill(process.pid, 'SIGKILL')"};
      } });
    `;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true,
    });
    expect(crashed.error).toBeUndefined();
    if (mode === 'exit') expect(crashed.status, crashed.stderr).toBe(17);
    else if (process.platform === 'win32') {
      expect(crashed.status, crashed.stderr).toBe(1);
      expect(crashed.signal).toBeNull();
    } else expect(crashed.signal, crashed.stderr).toBe('SIGKILL');
    expect(crashed.stderr).toBe('');
    expect(fs.readdirSync(root).filter(name => name.startsWith('.dist-ir-build-'))).toHaveLength(1);
    expect(epochs(output)).toEqual(['old', 'old', 'old']);
    await expect(buildIr({ root, compileTargets: ({ staging }) => writeTargets(staging) })).resolves.toBe(1);
    expect(epochs(output)).toEqual(['new', 'new', 'new']);
    expectStatic(output);
    expectNoTransactionFiles(root);
  });

  it('не удаляет staging живого соседнего процесса, но восстанавливает после его crash', async () => {
    const { root, output } = fixture();
    const script = `
      import { buildIr } from ${JSON.stringify(BUILD_MODULE)};
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      await buildIr({ root: ${JSON.stringify(root)}, async compileTargets({ staging }) {
        mkdirSync(join(staging, 'ir'));
        writeFileSync(join(staging, 'ir/index.js'), 'live operation');
        const released = new Promise(resolve => process.once('message', resolve));
        process.send({ staging });
        await released;
      } });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
    });
    const closed = once(child, 'close');
    let timer;
    try {
      const [message] = await Promise.race([
        once(child, 'message'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('live staging child timeout')), 5000); }),
      ]);
      clearTimeout(timer);
      await expect(buildIr({ root, compileTargets: ({ staging }) => writeTargets(staging) })).resolves.toBe(1);
      expect(fs.readFileSync(join(message.staging, 'ir/index.js'), 'utf8')).toBe('live operation');
      expect(epochs(output)).toEqual(['new', 'new', 'new']);
      expectStatic(output);
      expect(child.kill('SIGKILL')).toBe(true);
      await closed;
      await expect(buildIr({ root, compileTargets: ({ staging }) => writeTargets(staging) })).resolves.toBe(1);
      expectNoTransactionFiles(root);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
  });

  it('recovery сохраняет legacy, неизвестные имена, файлы, symlink и живой PID', async () => {
    const { root } = fixture();
    const departed = spawnSync(process.execPath, ['--eval', 'process.exit(0)'], { windowsHide: true });
    expect(departed.status).toBe(0);
    const abandoned = `.dist-ir-build-${departed.pid}-oldxxx`;
    write(root, `${abandoned}/value`, 'abandoned owned stage');
    const retained = ['.dist-ir-build-legacy', '.dist-ir-build-0-ABCdef', `.dist-ir-build-${process.pid}-living`];
    for (const name of retained) write(root, `${name}/value`, 'preserved');
    const file = `.dist-ir-build-${departed.pid}-afilex`;
    write(root, file, 'preserved file');
    const outside = join(root, 'unowned-link-target');
    write(outside, 'value', 'preserved outside link');
    const link = `.dist-ir-build-${departed.pid}-linked`;
    fs.symlinkSync(outside, join(root, link), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(buildIr({ root, compileTargets: ({ staging }) => writeTargets(staging) })).resolves.toBe(1);
    expect(fs.existsSync(join(root, abandoned))).toBe(false);
    for (const name of retained) expect(fs.readFileSync(join(root, name, 'value'), 'utf8')).toBe('preserved');
    expect(fs.readFileSync(join(root, file), 'utf8')).toBe('preserved file');
    expect(fs.lstatSync(join(root, link)).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(join(outside, 'value'), 'utf8')).toBe('preserved outside link');
  });

  it('EPERM при проверке owner не считается разрешением удалить staging', async () => {
    const { root } = fixture();
    const stage = join(root, `.dist-ir-build-${process.pid}-denied`);
    write(stage, 'value', 'permission unknown');
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('owner permission unknown'), { code: 'EPERM' });
    });
    try {
      await expect(buildIr({ root, compileTargets: ({ staging }) => writeTargets(staging) })).resolves.toBe(1);
      expect(probe).toHaveBeenCalledWith(process.pid, 0);
      expect(fs.readFileSync(join(stage, 'value'), 'utf8')).toBe('permission unknown');
    } finally {
      probe.mockRestore();
    }
  });

  it('заменяет все targets вместе, сохраняя static/catalog bytes и исключая прежние staging/backup', async () => {
    const { root, output } = fixture();
    write(output, 'symbols/stale.js', 'stale target');
    write(output, '.ir-previous/leaked.js', 'previous target');
    write(output, '.ir-platform-build-old/leaked.js', 'unfinished staging');
    const moves = [];
    await expect(buildIr({ root, compileTargets: ({ staging }) => writeTargets(staging),
      transactionFs: { ...fs, renameSync(from, to) { moves.push([from, to]); fs.renameSync(from, to); } } })).resolves.toBe(1);
    expect(epochs(output)).toEqual(['new', 'new', 'new']);
    expectStatic(output);
    expect(moves).toHaveLength(2);
    expect(moves[0][0]).toBe(output);
    expect(moves[1][1]).toBe(output);
    expect(fs.existsSync(join(output, 'symbols/stale.js'))).toBe(false);
    expect(fs.readdirSync(output).filter(name => name.startsWith('.'))).toEqual([]);
    expectNoTransactionFiles(root);
  });

  it('ошибка подготовки после первого target сохраняет всю прежнюю эпоху', async () => {
    const { root, output } = fixture();
    await expect(buildIr({ root, compileTargets({ staging }) {
      write(staging, 'ir/index.js', 'export const epoch = "new";');
      throw new Error('target preparation failed');
    } })).rejects.toThrow('target preparation failed');
    expect(epochs(output)).toEqual(['old', 'old', 'old']);
    expectStatic(output);
    expectNoTransactionFiles(root);
  });

  it('при отказе bundle ждёт остальных writers до cleanup, не оставляя поздний staging', async () => {
    const { root, output } = fixture();
    write(root, 'scripts/build-anatomy-projection.mjs', 'export {};');
    let started = 0;
    let finished = 0;
    const pending = [];
    vi.mocked(build).mockImplementation(({ outfile }) => {
      const first = started++ === 0;
      const operation = first
        ? Promise.reject(new Error('first bundle refused')).finally(() => { finished++; })
        : new Promise(resolveWrite => setTimeout(() => {
          write(dirname(outfile), basename(outfile), 'export {};');
          finished++;
          resolveWrite();
        }, 25));
      pending.push(operation);
      return operation;
    });
    try {
      await expect(buildIr({ root })).rejects.toThrow('first bundle refused');
      expect(started).toBe(8);
      expect(finished).toBe(8);
      expect(epochs(output)).toEqual(['old', 'old', 'old']);
      expectStatic(output);
      expectNoTransactionFiles(root);
    } finally {
      await Promise.allSettled(pending);
      vi.mocked(build).mockReset();
    }
  });

  it('не публикует неполную file surface или незамкнутые imports', async () => {
    for (const sabotage of ['missing', 'extra', 'import']) {
      const { root, output } = fixture();
      await expect(buildIr({ root, compileTargets({ staging }) {
        writeTargets(staging);
        if (sabotage === 'missing') fs.rmSync(join(staging, 'motion/index.d.ts'));
        if (sabotage === 'extra') write(staging, 'symbols/unlisted.js', 'export const extra = true;');
        if (sabotage === 'import') write(staging, 'ir/index.js', 'export { value } from "./missing.js";');
      } })).rejects.toThrow(/output surface drift|dependency closure/);
      expect(epochs(output)).toEqual(['old', 'old', 'old']);
      expectStatic(output);
      expectNoTransactionFiles(root);
    }
  });

  it('ошибка установки нового корня сразу возвращает все прежние targets и static', async () => {
    const { root, output } = fixture();
    let calls = 0;
    await expect(buildIr({ root, compileTargets: ({ staging }) => writeTargets(staging),
      transactionFs: { ...fs, renameSync(from, to) {
        if (++calls === 2) throw new Error('install rename failed');
        fs.renameSync(from, to);
      } } })).rejects.toThrow('install rename failed');
    expect(epochs(output)).toEqual(['old', 'old', 'old']);
    expectStatic(output);
    expectNoTransactionFiles(root);
  });

  it.each([1, 2])('после остановки за rename %i следующий caller восстанавливает целый корень', async stoppedAfter => {
    const { root, output, backup } = fixture();
    let calls = 0;
    await expect(buildIr({ root, compileTargets: ({ staging }) => writeTargets(staging),
      transactionFs: { ...fs, renameSync(from, to) {
        fs.renameSync(from, to);
        if (++calls === stoppedAfter) throw new Error('process stopped after rename');
      } } })).rejects.toThrow('process stopped after rename');
    expect(fs.existsSync(backup)).toBe(true);
    if (stoppedAfter === 1) expect(fs.existsSync(output)).toBe(false);
    else expect(epochs(output)).toEqual(['new', 'new', 'new']);
    // Recovery выполняется до нового compiler, даже когда тот ещё не смог
    // подготовить следующую версию: persisted epoch уже однозначна.
    await expect(buildIr({ root, compileTargets() { throw new Error('next compile stopped'); } })).rejects.toThrow('next compile stopped');
    expect(epochs(output)).toEqual(Array(3).fill(stoppedAfter === 1 ? 'old' : 'new'));
    expectStatic(output);
    expectNoTransactionFiles(root);
  });

  it('отклоняет symlink/junction в retained static tree, не копируя его содержимое', async () => {
    const { root, output } = fixture();
    const linked = join(root, 'unowned-static');
    write(linked, 'value', 'outside dist');
    fs.symlinkSync(linked, join(output, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    let compilations = 0;
    await expect(buildIr({ root, compileTargets() { compilations++; } })).rejects.toThrow('symbolic link');
    expect(compilations).toBe(0);
    expect(epochs(output)).toEqual(['old', 'old', 'old']);
    expect(fs.readFileSync(join(linked, 'value'), 'utf8')).toBe('outside dist');
    expectNoTransactionFiles(root);
  });
});
