import { describe, expect, it } from 'vitest';
import { createHandHistory } from '../scripts/lib/hand-history.js';

const NEW = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NEW_ANATOMY_BLOB = '1'.repeat(40);
const OLD_ANATOMY_BLOB = '2'.repeat(40);
const HAND_BLOB = '3'.repeat(40);
const EARLY_HAND_BLOB = '4'.repeat(40);

const treeLine = (blobSha, path) => `100644 blob ${blobSha}\t${path}\n`;

function fixtureGit({ shallow = false, malformedOldAnatomy = false, oldStatus = 'hand' } = {}) {
  const calls = [];
  const blobs = new Map([
    [NEW_ANATOMY_BLOB, JSON.stringify({ glyphs: { demo: { status: { outline: 'generated' } } } })],
    [OLD_ANATOMY_BLOB, malformedOldAnatomy
      ? '{broken'
      : JSON.stringify({ glyphs: { demo: { status: { outline: oldStatus } } } })],
    [HAND_BLOB, '<svg><path d="M0 0L1 0L1 1Z"/></svg>'],
  ]);

  const runGit = (args) => {
    const command = args.join(' ');
    calls.push(command);

    if (command === 'rev-parse --is-shallow-repository') return shallow ? 'true\n' : 'false\n';
    if (command === 'log --follow --format=@%H%x09%cs --name-status -- svg/Outline/demo.svg') {
      return `@${NEW}\t2026-07-10\nM\tsvg/Outline/demo.svg\n\n@${OLD}\t2026-07-01\nM\tlegacy/demo.svg\n`;
    }
    if (command === `ls-tree -r ${NEW} -- semantics/anatomy.json`) {
      return treeLine(NEW_ANATOMY_BLOB, 'semantics/anatomy.json');
    }
    if (command === `ls-tree -r ${OLD} -- semantics/anatomy.json`) {
      return treeLine(OLD_ANATOMY_BLOB, 'semantics/anatomy.json');
    }
    if (command === `ls-tree -r ${OLD} -- legacy/demo.svg`) {
      return treeLine(HAND_BLOB, 'legacy/demo.svg');
    }
    if (command.startsWith('cat-file blob ')) {
      const blob = args[2];
      if (!blobs.has(blob)) throw new Error(`unknown blob ${blob}`);
      return blobs.get(blob);
    }
    throw new Error(`unexpected git call: ${command}`);
  };

  return { runGit, calls };
}

describe('hand-history', () => {
  it('пропускает generated-ревизию и возвращает commit+blob provenance последней руки', () => {
    const fake = fixtureGit();
    const history = createHandHistory('/virtual', { runGit: fake.runGit });
    const baseline = history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline');

    expect(baseline).toEqual({
      svg: '<svg><path d="M0 0L1 0L1 1Z"/></svg>',
      commitSha: OLD,
      shortCommitSha: OLD.slice(0, 7),
      blobSha: HAND_BLOB,
      date: '2026-07-01',
      path: 'legacy/demo.svg',
    });
  });

  it('берёт конечный путь rename/copy записи, а не первую строку наугад', () => {
    const runGit = (args) => {
      const command = args.join(' ');
      if (command === 'log --follow --format=@%H%x09%cs --name-status -- svg/Outline/demo.svg') {
        return `@${OLD}\t2026-07-01\nR100\tlegacy/demo.svg\tsvg/Outline/demo.svg\n`;
      }
      throw new Error(`unexpected git call: ${command}`);
    };

    const revisions = createHandHistory('/virtual', { runGit }).fileHistory('svg/Outline/demo.svg');
    expect(revisions).toEqual([
      { commitSha: OLD, date: '2026-07-01', path: 'svg/Outline/demo.svg', change: 'R' },
    ]);
  });

  it('считает ревизию до появления anatomy ручной, но не проглатывает другие ошибки', () => {
    const runGit = (args) => {
      const command = args.join(' ');
      if (command === 'log --follow --format=@%H%x09%cs --name-status -- svg/Filled/demo_filled.svg') {
        return `@${OLD}\t2026-06-01\nA\tsvg/Filled/demo_filled.svg\n`;
      }
      if (command === `ls-tree -r ${OLD} -- semantics/anatomy.json`) return '';
      if (command === `ls-tree -r ${OLD} -- svg/Filled/demo_filled.svg`) {
        return treeLine(EARLY_HAND_BLOB, 'svg/Filled/demo_filled.svg');
      }
      if (command === `cat-file blob ${EARLY_HAND_BLOB}`) return '<svg><path d="M0 0Z"/></svg>';
      throw new Error(`unexpected git call: ${command}`);
    };

    const baseline = createHandHistory('/virtual', { runGit })
      .handFromHistory('svg/Filled/demo_filled.svg', 'demo', 'filled');
    expect(baseline?.blobSha).toBe(EARLY_HAND_BLOB);
  });

  it('кусается на повреждённом историческом anatomy вместо ложного hand baseline', () => {
    const fake = fixtureGit({ malformedOldAnatomy: true });
    const history = createHandHistory('/virtual', { runGit: fake.runGit });

    expect(() => history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline'))
      .toThrow(/anatomy\.json@bbbbbbb невалиден/);
  });

  it('кусается на неизвестном status вместо неявного признания его рукой', () => {
    const fake = fixtureGit({ oldStatus: 'parked' });
    const history = createHandHistory('/virtual', { runGit: fake.runGit });

    expect(() => history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline'))
      .toThrow(/неизвестный status "parked"/);
  });

  it('не превращает ошибку git в отсутствие файла', () => {
    const runGit = (args) => {
      const command = args.join(' ');
      if (command === 'log --follow --format=@%H%x09%cs --name-status -- svg/Outline/demo.svg') {
        return `@${OLD}\t2026-07-01\nM\tsvg/Outline/demo.svg\n`;
      }
      if (command === `ls-tree -r ${OLD} -- semantics/anatomy.json`) {
        throw new Error('repository corrupt');
      }
      throw new Error(`unexpected git call: ${command}`);
    };

    const history = createHandHistory('/virtual', { runGit });
    expect(() => history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline'))
      .toThrow('repository corrupt');
  });

  it('явно обнаруживает shallow checkout', () => {
    const fake = fixtureGit({ shallow: true });
    expect(createHandHistory('/virtual', { runGit: fake.runGit }).isShallow()).toBe(true);
  });

  it('кэширует git log, tree entries, anatomy и blob bytes', () => {
    const fake = fixtureGit();
    const history = createHandHistory('/virtual', { runGit: fake.runGit });
    history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline');
    history.handFromHistory('svg/Outline/demo.svg', 'demo', 'outline');

    expect(fake.calls.filter((call) => call.startsWith('log --follow'))).toHaveLength(1);
    expect(fake.calls.filter((call) => call === `ls-tree -r ${NEW} -- semantics/anatomy.json`)).toHaveLength(1);
    expect(fake.calls.filter((call) => call === `ls-tree -r ${OLD} -- semantics/anatomy.json`)).toHaveLength(1);
    expect(fake.calls.filter((call) => call === `cat-file blob ${HAND_BLOB}`)).toHaveLength(1);
  });

  it('отвергает неизвестный variant и выход за корень репозитория', () => {
    const fake = fixtureGit();
    const history = createHandHistory('/virtual', { runGit: fake.runGit });

    expect(() => history.handFromHistory('svg/Outline/demo.svg', 'demo', 'duotone'))
      .toThrow(/неизвестный variant/);
    expect(() => history.fileHistory('../outside.svg')).toThrow(/выход за корень/);
  });
});
