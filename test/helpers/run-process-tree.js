import { spawn, spawnSync } from 'node:child_process';

// A shell's timeout does not stop its compiler children on Windows. Keep the
// parent alive until taskkill can find the complete tree, then await closed IO.
// This covers foreground build commands, whose parent awaits its children.
// Detached descendants are not supported; failed termination is an error.
export function runProcessTree(file, args, { cwd, env, signal, maxBuffer = 10 * 1024 * 1024 } = {}) {
  signal?.throwIfAborted();
  return new Promise(resolve => {
    const child = spawn(file, args, {
      cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error, stdout = '', stderr = '', bytes = 0, stopped = false, finished = false, closeDeadline;
    const finish = (status, killedBy) => {
      if (finished) return;
      finished = true;
      clearTimeout(closeDeadline);
      signal?.removeEventListener('abort', abort);
      resolve({ status, signal: killedBy, error, stdout, stderr });
    };
    const stop = reason => {
      if (stopped || finished) return;
      stopped = true;
      error ??= reason;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, encoding: 'utf8', timeout: 5_000,
        });
        if (killed.error || killed.status !== 0) error = new AggregateError([error,
          killed.error ?? new Error(`taskkill exited ${killed.status}: ${killed.stderr}`)], 'process tree termination failed');
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (failure) {
          if (failure.code !== 'ESRCH') error = new AggregateError([error, failure], 'process group termination failed');
        }
      }
      closeDeadline = setTimeout(() => {
        error = new AggregateError([error], 'process IO did not close after termination');
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish(null, null);
      }, 5_000);
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
    child.once('close', finish);
  });
}
