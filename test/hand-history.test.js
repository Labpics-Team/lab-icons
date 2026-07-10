import { describe, expect, it } from 'vitest';
import { createHandHistory } from '../scripts/lib/hand-history.js';

const NEW = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OLD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function fakeGit({ shallow = false } = {}) {
  const calls = [];
  const runGit = (args) => {
    calls.push(args.join(' '));
    const command = args.join(' ');
    if (command === 'rev-parse --is-shallow-repository') return shallow ? 'true\n' : 'false\n';
    if (command.startsWith('log --follow')) {
      return `@${NEW} 2026-07-10\nsvg/Outline/demo.svg\n\n@${OLD} 2026-07-01\nlegacy/demo.svg\n`;
    }
    if (command === `show ${NEW}:semantics/anatomy.json`) {
      return JSON.stringify({ glyphs: { demo: { status: { outline: 'generated' } } } });
    }
    if (command === `show ${OLD}:semantics/anatomy.json`) {
      return JSON.stringify({ glyphs: { demo: { status: { outline: 'hand' } } } });
    }
    if (command === `show ${OLD}:legacy/demo.svg`) {
      return '<svg><path d="M0 0L1 0L1 1Z"/></svg>';
    }
    throw new Error(`unexpected git call: ${command}`);
  };
  return { runGit, calls };
}

describe('hand-history', () => {
  it('пропускает generated-ревизию и возвращает последний hand blob с полным SHA', () => {
    const fake = fakeGit();
    const history = createHandHistory('/virtual', { runGit: fake.runGit });
    const baseline = history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline');

    expect(baseline).toEqual({
      svg: '<svg><path d="M0 0L1 0L1 1Z"/></svg>',
      sha: OLD,
      shortSha: OLD.slice(0, 7),
      date: '2026-07-01',
      path: 'legacy/demo.svg',
    });
  });

  it('считает ревизию до появления anatomy ручной по построению', () => {
    const runGit = (args) => {
      const command = args.join(' ');
      if (command.startsWith('log --follow')) {
        return `@${OLD} 2026-07-01\nsvg/Filled/demo_filled.svg\n`;
      }
      if (command === `show ${OLD}:semantics/anatomy.json`) throw new Error('missing');
      if (command === `show ${OLD}:svg/Filled/demo_filled.svg`) return '<svg><path d="M0 0Z"/></svg>';
      if (command === 'rev-parse --is-shallow-repository') return 'false\n';
      throw new Error(command);
    };
    const history = createHandHistory('/virtual', { runGit });
    expect(history.handFromHistory('svg/Filled/demo_filled.svg', 'demo', 'filled')?.sha).toBe(OLD);
  });

  it('явно обнаруживает shallow checkout', () => {
    const fake = fakeGit({ shallow: true });
    expect(createHandHistory('/virtual', { runGit: fake.runGit }).isShallow()).toBe(true);
  });

  it('кэширует историю файла и anatomy по SHA', () => {
    const fake = fakeGit();
    const history = createHandHistory('/virtual', { runGit: fake.runGit });
    history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline');
    history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline');

    expect(fake.calls.filter((call) => call.startsWith('log --follow'))).toHaveLength(1);
    expect(fake.calls.filter((call) => call === `show ${NEW}:semantics/anatomy.json`)).toHaveLength(1);
    expect(fake.calls.filter((call) => call === `show ${OLD}:semantics/anatomy.json`)).toHaveLength(1);
  });
});
