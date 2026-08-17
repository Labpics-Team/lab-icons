import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const temporary = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function proposal(overrides = {}) {
  return {
    version: 1,
    icon: 'sample',
    intent: 'Represent a generic sample while preserving the Lab Icons visual language.',
    family: {
      references: ['square'],
      sharedRules: ['centered on the square keyline', 'outline and filled preserve registration'],
    },
    keyline: { kind: 'square', reason: 'The proposed sample is a compact square-shaped mass.' },
    variants: {
      relationship: 'independent-masters',
      outline: {
        role: 'regular contour master',
        negativeSpace: [{
          id: 'body.interior',
          kind: 'counter',
          minimum: 0.033333,
          participants: ['body'],
          measurement: 'minimum counter width inside the outline body',
        }],
      },
      filled: {
        role: 'solid companion master',
        negativeSpace: [{
          id: 'body.exterior',
          kind: 'exterior-margin',
          minimum: 0.041667,
          participants: ['body'],
          measurement: 'minimum ink-bounds distance to the canvas edge',
        }],
      },
    },
    opticalSizing: {
      mode: 'fixed-master',
      masters: [{ size: 24, source: 'paired Figma export' }],
      behavior: ['no optical-size capability is claimed'],
    },
    parts: [{ id: 'body', role: 'body', anchor: null, moves: false }],
    motion: { state: 'none', gestures: [] },
    ...overrides,
  };
}

function exportPair({ outline, filled, brief = proposal() }) {
  const directory = mkdtempSync(join(tmpdir(), 'lab-icons-proposal-'));
  temporary.push(directory);
  mkdirSync(join(directory, 'Outline'));
  mkdirSync(join(directory, 'Filled'));
  writeFileSync(join(directory, 'Outline', 'sample.svg'), outline);
  writeFileSync(join(directory, 'Filled', 'sample.svg'), filled);
  if (brief !== null) writeFileSync(join(directory, 'proposal.json'), JSON.stringify(brief, null, 2));
  return directory;
}

function svg(d) {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#101012"/></svg>`;
}

function run(directory, ...args) {
  return spawnSync(
    process.execPath,
    [join(root, 'scripts', 'validate-icon-proposal.mjs'), '--source', directory, ...args],
    { cwd: root, encoding: 'utf8' },
  );
}

describe('validate:proposal', () => {
  it('accepts a paired monochrome proposal without writing to the repository', () => {
    const directory = exportPair({
      outline: svg('M10 10h4v4h-4z'),
      filled: svg('M10 10h4v4h-4z'),
    });
    const result = run(directory, '--json');

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'PASS',
      selected: 1,
      variants: 2,
    });
  });

  it('fails closed when the proposal violates the source language', () => {
    const directory = exportPair({
      outline: svg('M10 10h4v4h-4z'),
      filled: svg('M10 10h4v4h-4z').replace('#101012', '#ff0000'),
    });
    const result = run(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('монохром');
  });

  it('fails closed without a machine-readable authoring brief', () => {
    const directory = exportPair({
      outline: svg('M10 10h4v4h-4z'),
      filled: svg('M10 10h4v4h-4z'),
      brief: null,
    });
    const result = run(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('proposal.json');
  });

  it('fails closed when the brief references an unknown style family', () => {
    const directory = exportPair({
      outline: svg('M10 10h4v4h-4z'),
      filled: svg('M10 10h4v4h-4z'),
      brief: proposal({
        family: { references: ['not-in-the-catalog'], sharedRules: ['copy its style'] },
      }),
    });
    const result = run(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('неизвестные family.references');
  });

  it('fails when a keyline proposal is off-center', () => {
    const circle = (cx) => `M${cx - 11} 12a11 11 0 1 0 22 0a11 11 0 1 0 -22 0Z`;
    const inner = (cx) => `M${cx - 9.5} 12a9.5 9.5 0 1 0 19 0a9.5 9.5 0 1 0 -19 0Z`;
    const directory = exportPair({
      outline: svg(`${circle(12.5)}${inner(12.5)}M10 10h4v4h-4z`),
      filled: svg(`${circle(12)}M10 10h4v4h-4z`),
    });
    const result = run(directory, '--json');

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'FAIL' });
  });
});
