import { spawn, spawnSync } from 'node:child_process';

// A shell's timeout does not stop its compiler children on Windows. Keep the
// parent alive until taskkill can find the complete tree, then await closed IO.
export function runProcessTree(file, args, { cwd, signal, maxBuffer = 10 * 1024 * 1024 } = {}) {
  signal?.throwIfAborted();
  return new Promise(resolve => {
    const child = spawn(file, args, {
      cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error, stdout = '', stderr = '', bytes = 0;
    const stop = reason => {
      if (error) return;
      error = reason;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (failure) {
          if (failure.code !== 'ESRCH') throw failure;
        }
      }
    };
    const abort = () => stop(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const capture = (chunk, target) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBuffer) { stop(new Error(`process output exceeds ${maxBuffer} bytes`)); return; }
      if (target === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding('utf8').on('data', chunk => capture(chunk, 'stdout'));
    child.stderr.setEncoding('utf8').on('data', chunk => capture(chunk, 'stderr'));
    child.once('error', failure => { error ??= failure; });
    child.once('close', (status, killedBy) => {
      signal?.removeEventListener('abort', abort);
      resolve({ status, signal: killedBy, error, stdout, stderr });
    });
  });
}
