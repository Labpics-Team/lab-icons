import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const [control, selected, expected] of [
  ['crop', 'independent-paints', /raster mismatch/],
  ['color', 'independent-paints', /raster mismatch/],
  ['symbol', 'independent-paints', /raster mismatch/],
  ['terminal', 'reload/cycle/forward', /raster mismatch/],
  ['missing-effect', 'reload/cycle/forward', /installed effect membership differs from source/],
  ['', 'unknown-case', /No selected Lottie cases/],
]) {
  let failure = '';
  try {
    execFileSync(process.execPath, [join(root, 'scripts/verify-symbol-lottie.mjs'), selected], {
      cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LAB_ICONS_LOTTIE_CONTROL: control,
        LAB_ICONS_EVIDENCE_DIR: join(process.env.LAB_ICONS_EVIDENCE_DIR ?? join(root, 'preview/symbol-lottie'), 'controls', control || 'empty') },
    });
  } catch (error) { failure = error.stderr?.toString() ?? error.message; }
  assert(expected.test(failure), `${control || 'empty'} control did not detect its defect: ${failure || 'PASS'}`);
}
console.log('Lottie controls: cropped canvas, wrong color/symbol, lost terminal pose/effect, empty selection detected');
