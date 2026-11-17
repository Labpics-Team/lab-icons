import { describe, expect, it, vi } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { packDotLottie } from '../src/lottie/dotlottie.ts';
import { exportLottie } from '../dist/lottie/reload.js';

function animation() {
  const result = exportLottie({ gesture: 'reload.cycle', duration: 1000 });
  if (!result.ok) throw new Error(result.reason.message);
  return result.animation;
}

/** Read ZIP local headers and inflate with Node's independent Deflate decoder. */
function entries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 6, true) & 8).toBe(0); // Sizes are in this header.
    expect(view.getUint16(offset + 8, true)).toBe(8); // Deflate, as specified by dotLottie.
    expect(view.getUint16(offset + 10, true)).toBe(0); // 00:00:00.
    expect(view.getUint16(offset + 12, true)).toBe(33); // 1980-01-01.
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameSize = view.getUint16(offset + 26, true);
    const extraSize = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameSize));
    const start = offset + 30 + nameSize + extraSize;
    const data = inflateRawSync(bytes.subarray(start, start + compressedSize));
    expect(data.length).toBe(uncompressedSize);
    files.set(name, new TextDecoder().decode(data));
    offset = start + compressedSize;
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50); // Central directory follows.
  expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(bytes.length - 12, true)).toBe(files.size);
  return files;
}

describe('dotLottie packaging of the existing Lottie result', () => {
  it('writes the v2 manifest and the identical UTF-8 animation JSON with Deflate', () => {
    const source = animation();
    source.nm = 'Календарь 📅 日本語';
    const original = JSON.stringify(source);
    const archive = entries(packDotLottie(source, { id: 'calendar 1.2_test-next' }));
    expect([...archive.keys()]).toEqual(['manifest.json', 'a/calendar 1.2_test-next.json']);
    expect(JSON.parse(archive.get('manifest.json'))).toEqual({ version: '2', animations: [{ id: 'calendar 1.2_test-next' }] });
    expect(archive.get('a/calendar 1.2_test-next.json')).toBe(original);
    expect(JSON.stringify(source)).toBe(original);
  });

  it('returns deterministic independent bytes and does not depend on the current date', () => {
    const source = animation();
    const first = packDotLottie(source), expected = first.slice();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2040-08-09T10:11:12Z'));
      const second = packDotLottie(source);
      expect(second).toEqual(expected);
      expect(second).not.toBe(first);
      first.fill(0);
      expect(second).toEqual(expected);
    } finally { vi.useRealTimers(); }
    expect(JSON.parse(entries(packDotLottie(source)).get('manifest.json')).animations).toEqual([{ id: 'animation' }]);
  });

  it.each(['', '../escape', 'a/b', 'a\\b', 'line\nbreak', 'last\n', 'tab\tid', 'календарь', '📅', null, 3])('rejects an invalid archive id %j', id => {
    expect(() => packDotLottie(animation(), { id })).toThrow(RangeError);
  });

  it('rejects invalid request envelopes and lets JSON serialization reject cycles', () => {
    for (const options of [null, [], 'id', { typo: 'animation' }]) {
      expect(() => packDotLottie(animation(), options)).toThrow(TypeError);
    }
    for (const source of [null, [], 'json']) expect(() => packDotLottie(source)).toThrow(TypeError);
    const cyclic = animation(); cyclic.self = cyclic;
    expect(() => packDotLottie(cyclic)).toThrow(TypeError);
  });
});
