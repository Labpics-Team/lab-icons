import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** An external consumer must not silently fall back to the checkout's package. */
export function installedBrowserInputs(metafile, root, consumerDir) {
  const inputs = Object.keys(metafile.inputs);
  assert(!inputs.some(input => /src[/\\]core[/\\]path-data|author-anatomy|catalog\.json/.test(input)), 'Browser export retained an author parser/catalog');
  if (!consumerDir) return inputs;
  const installed = realpathSync(join(consumerDir, 'node_modules/@labpics/icons'));
  const icons = inputs.filter(input => /(?:^|[/\\])dist[/\\](?:symbols|states|export|runtime|render|lottie|ir)[/\\]/.test(input));
  assert(icons.length > 0, 'Installed browser consumer resolved no Icons modules');
  for (const input of icons) {
    const path = relative(installed, realpathSync(resolve(root, input)));
    assert(!path.startsWith('..') && !isAbsolute(path), `Icons browser input escaped installed package: ${input}`);
  }
  return inputs;
}
