import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import volume from '../dist/symbols/volume-high.js';
import volumeStates from '../dist/states/volume.js';
import { renderIcon } from '../src/render/index.js';

describe('semantic import boundary', () => {
  it('keeps the single symbol independent from its opt-in state family', () => {
    expect(volume.semantics.states).toBeUndefined();
    expect(Object.keys(volumeStates.semantics.states)).toEqual(['high', 'middle', 'low', 'quiet', 'mute', 'off']);
    expect(volumeStates.semantics.states.high.data).toBeUndefined();
    expect(renderIcon(volumeStates, { state: 'high' })).toBe(renderIcon(volume));
    expect(() => renderIcon(volume, { state: 'low' })).toThrow('does not define state');
  });
  it('rejects prototype names instead of treating them as declared states', () => {
    for (const state of ['constructor', 'toString', '__proto__']) expect(() => renderIcon(volumeStates, { state })).toThrow('does not define state');
  });
  it('does not retain another level of volume in a single-symbol render bundle', async () => {
    const result = await build({ stdin: { contents: "import volume from '@labpics/icons/symbols/volume-high'; import {renderIcon} from '@labpics/icons/render'; console.log(renderIcon(volume));", resolveDir: process.cwd() },
      bundle: true, format: 'esm', write: false, minify: true });
    expect(result.outputFiles[0].text).not.toContain('volume-low');
    expect(result.outputFiles[0].text).not.toContain('volume-muted');
  });
  it('ships a state-family default without removing existing state wrappers', async () => {
    const microphone = await import('../dist/states/microphone.js');
    expect(microphone.default.semantics.states.off.id).toBe('mic-off');
    expect(typeof microphone.compileStateEffect).toBe('function');
    expect(JSON.parse(readFileSync(new URL('../release/export-surface.json', import.meta.url), 'utf8'))['./states/microphone']).toContain('default');
  });
});
