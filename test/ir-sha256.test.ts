import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/ir/sha256.js';

describe('browser-safe SHA-256 provenance oracle', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['Lab Icons ✓', '3593da4e11492de0b3a4f3fe3d48077fe078ce4da4f10a89e8b8f161da9772ba'],
  ])('совпадает с нормативным digest для %j', (input, digest) => {
    expect(sha256Hex(input)).toBe(digest);
  });
});
