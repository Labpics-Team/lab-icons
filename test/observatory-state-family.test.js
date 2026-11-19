import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../observatory/explorer.js', import.meta.url), 'utf8');
const selectSource = source.match(/^async function select\([^\n]*\) \{[\s\S]*?^\}/m)?.[0];
const groups = [
  { group: 'microphone', members: [{ icon: 'mic', variant: 'outline', state: 'unmuted' }, { icon: 'mic-off', variant: 'outline', state: 'muted' }] },
  { group: 'microphone-presentation', members: [{ icon: 'mic', variant: 'outline', state: 'plain' }, { icon: 'mic-circle', variant: 'outline', state: 'circle' }] },
  { group: 'microphone-filled', members: [{ icon: 'mic', variant: 'filled', state: 'unmuted' }] },
];

function fixture({ holdFirst = false, acceptedGroups = groups, initialVariant = 'outline' } = {}) {
  if (!selectSource) throw new Error('Реальный select не найден.');
  const sourceIdentity = { fileKey: 'fixture', version: '1' };
  const state = { revision: 0, name: 'mic', variant: 'outline', glyph: { previous: true }, loaded: true,
    data: { source: sourceIdentity, stateGroups: acceptedGroups, variationIconIds: [], stateVariationGroupIds: [],
      rotationGestureIconIds: [], preparedWidthIconIds: [], preparedClockIconIds: [] } };
  const node = () => ({ value: '', hidden: false, disabled: false, textContent: '',
    setAttribute() {}, replaceChildren(...options) { this.options = options; this.value = options[0]?.value ?? ''; } });
  const ui = Object.fromEntries(['symbol-name', 'symbol-stage', 'source-status', 'export-status', 'progress', 'state-family', 'state-family-control'].map(id => [id, node()]));
  ui.variant = { value: initialVariant };
  ui['state-family'].parentElement = { textContent: 'Варианты' };
  const calls = [], rendered = [];
  let stops = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const dynamicImport = async file => {
    calls.push(file);
    if (holdFirst && calls.filter(path => path.startsWith('./package/states/')).length === 1 && file.startsWith('./package/states/')) await held;
    if (file.startsWith('./package/symbols/')) return { glyphCapabilities: () => ({ variation: null }), glyph: () => ({ authored: true }) };
    const group = acceptedGroups.find(group => file === `./package/states/${group.group}.js`);
    if (!group) throw new Error(`Неожиданный import ${file}`);
    return { stateCapabilities: () => ({ group: group.group, variant: group.members[0].variant,
      states: group.members.map(member => ({ id: member.state, icon: member.icon })), proof: { source: sourceIdentity } }) };
  };
  function Option(label, value) { return { label, value }; }
  const declarations = ['stateMemberships', 'stateFamilyLabel', 'updateStateFamilyChoices'].map(name =>
    source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0] ?? '').join('\n');
  const select = new Function('state', 'ui', 'stop', 'selectedRow', 'loadMessage', 'clearInspector', 'inspectorBusy', 'grid',
    'dynamicImport', 'fetch', 'controls', 'renderView', 'admitAuthoredGesture', 'admitPreparedWidth', 'Option', 'stateLabel',
    `${declarations}\n${selectSource.replace(/\bimport\(/g, 'dynamicImport(')}\nreturn select;`)(
    state, ui, () => { stops++; }, () => ({ views: { original: '/master.svg' }, original: {} }),
    () => {}, () => {}, () => {}, () => {}, dynamicImport, async () => ({ ok: true, text: async () => '<svg />' }),
    () => {}, async () => { rendered.push(state.replacement?.capabilities.group ?? null); }, () => null, () => null, Option, id => id,
  );
  return { state, ui, calls, rendered, release, select, stops: () => stops };
}

describe('Observatory открывает каждую принятую группу выбранного символа', () => {
  it('сохраняет первый default и по явному выбору загружает только вторую группу', async () => {
    const first = fixture();
    await first.select('mic');
    expect(first.state.replacement.capabilities.group).toBe('microphone');
    const selected = fixture();
    await selected.select('mic', { stateGroup: 'microphone-presentation' });
    expect(selected.state.replacement.capabilities.group).toBe('microphone-presentation');
    expect(selected.calls.filter(file => file.startsWith('./package/states/'))).toEqual(['./package/states/microphone-presentation.js']);
    expect(selected.state.replacement.target).toBe('plain');
    expect(selected.ui['state-family-control'].hidden).toBe(false);
    expect(selected.ui['state-family'].disabled).toBe(false);
    expect(selected.ui['state-family'].options.map(option => ({ label: option.label, value: option.value }))).toEqual([
      { label: 'Включение', value: 'microphone' }, { label: 'Обрамление', value: 'microphone-presentation' },
    ]);
    expect(selected.ui['state-family'].value).toBe('microphone-presentation');
  });

  it('не принимает группу чужого символа или начертания и сохраняет прежний рисунок', async () => {
    for (const stateGroup of ['unknown', 'microphone-filled']) {
      const { select, state, calls, stops } = fixture();
      await expect(select('mic', { stateGroup })).rejects.toThrow(/Группа недоступна/);
      expect(state.glyph).toEqual({ previous: true });
      expect(calls).toEqual([]);
      expect(stops()).toBe(0);
    }
  });

  it('поздний import прежней группы не меняет новый выбор и его mounted состояние', async () => {
    const { select, state, rendered, release } = fixture({ holdFirst: true });
    const previous = select('mic', { stateGroup: 'microphone' });
    await select('mic', { stateGroup: 'microphone-presentation' });
    release();
    await previous;
    expect(state.replacement.capabilities.group).toBe('microphone-presentation');
    expect(state.replacement.target).toBe('plain');
    expect(rendered).toEqual(['microphone-presentation']);
  });

  it('не добавляет выбор для единственной группы или символа без групп', async () => {
    for (const name of ['mic-circle', 'reload']) {
      const { select, ui, state } = fixture();
      await select(name);
      expect(ui['state-family-control'].hidden).toBe(true);
      expect(ui['state-family'].disabled).toBe(true);
      expect(state.replacement?.capabilities.group ?? null).toBe(name === 'mic-circle' ? 'microphone-presentation' : null);
    }
  });

  it('native control имеет видимую подпись, а конечные состояния — предметные названия', () => {
    const html = readFileSync(new URL('../observatory/index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/<label[^>]*id="state-family-control"[^>]*>Варианты<select id="state-family"/);
    const labels = source.match(/^const stateLabels = Object\.freeze\(\{[\s\S]*?\}\);/m)?.[0];
    expect(new Function(`${labels}\nreturn stateLabels;`)()).toMatchObject({ plain: 'Без обрамления', circle: 'В круге' });
  });

  it.each([['mic', 'outline'], ['plus-circle', 'outline'], ['mic', 'filled'], ['plus-circle', 'filled']])(
    'journey принимает реальное число групп %s/%s и переключает только доступный selector', async (name, variant) => {
      const spec = JSON.parse(readFileSync(new URL('../semantics/author-state-groups.json', import.meta.url), 'utf8'));
      const acceptedGroups = Object.entries(spec.groups).map(([group, value]) => ({ group,
        members: Object.entries(value.states).map(([state, member]) => ({ state, icon: member.icon, variant: member.variant })),
      }));
      const value = fixture({ acceptedGroups, initialVariant: variant });
      await value.select(name);
      const memberships = acceptedGroups.filter(group => group.members.some(member => member.icon === name && member.variant === variant));
      const presentation = memberships.find(group => group.members.some(member => member.state === 'plain') &&
        group.members.some(member => member.state === 'circle'));
      if (name === 'plus-circle' && variant === 'filled') expect(memberships.map(group => group.group)).toEqual(['plus-presentation-filled']);
      const journey = readFileSync(new URL('../scripts/bench/explorer-journey.js', import.meta.url), 'utf8');
      const start = journey.indexOf('      check(`${id}/all-memberships-accessible`');
      const end = journey.indexOf('      const module = await import(`./package/states/${presentation.group}.js`);', start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const run = new Function('q', 'check', 'memberships', 'presentation', 'id', 'settle', 'Event', 'name',
        `return (async () => { ${journey.slice(start, end)} })();`);
      let pending, dispatched = 0;
      value.ui['state-family'].dispatchEvent = () => {
        dispatched++;
        pending = value.select(name, { stateGroup: value.ui['state-family'].value });
      };
      await run(id => value.ui[id], (id, passed) => { if (!passed) throw new Error(id); },
        memberships, presentation, `presentation/${name}/${variant}`, async () => pending, function Event() {}, name);
      expect(dispatched).toBe(memberships.length > 1 ? 1 : 0);
      expect(value.state.replacement.capabilities.group).toBe(presentation.group);
      expect(value.ui['state-family-control'].hidden).toBe(memberships.length < 2);
      expect(value.ui['state-family'].disabled).toBe(memberships.length < 2);
    },
  );
});
