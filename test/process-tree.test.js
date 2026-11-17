import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runProcessTree } from './helpers/run-process-tree.js';

it('keeps ordinary command output and exit status', async () => {
  const result = await runProcessTree(process.execPath, ['-e', "console.log('out'); console.error('err'); process.exitCode = 7"],
    { signal: AbortSignal.timeout(10_000) });
  expect(result).toMatchObject({ status: 7, error: undefined, stdout: 'out\n', stderr: 'err\n' });
});

it('cancellation closes the parent and its running descendant before cleanup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lab-icons-process-tree-'));
  const ready = join(directory, 'ready.json');
  const controller = new AbortController();
  const descendant = "setInterval(() => {}, 1000)";
  const parent = `const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'inherit', windowsHide:true});
    require('node:fs').writeFileSync(process.argv[1], JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);`;
  const running = runProcessTree(process.execPath, ['-e', parent, ready], { signal: controller.signal });
  try {
    await expect.poll(() => JSON.parse(readFileSync(ready, 'utf8')), { timeout: 10_000 }).toHaveLength(2);
    const pids = JSON.parse(readFileSync(ready, 'utf8'));
    for (const pid of pids) expect(() => process.kill(pid, 0)).not.toThrow();
    controller.abort(new Error('cancel test process tree'));
    const result = await running;
    expect(result.error.message).toBe('cancel test process tree');
    for (const pid of pids) await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    }).toBe(false);
  } finally {
    controller.abort(new Error('test cleanup'));
    await running;
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
