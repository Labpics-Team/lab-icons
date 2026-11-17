import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { assessAudit } from '../scripts/check-security.mjs';

const policy = parse(readFileSync(new URL('../.trivyignore.yaml', import.meta.url), 'utf8'));
const advisory = 'GHSA-fc5q-39xc-vjpf';
const registry = { name: 'picomatch', versions: { '4.0.5': {}, '4.0.7': {} } };
const now = new Date('2026-11-18T00:00:00Z');
const fixture = () => ({ metadata: { vulnerabilities: { high: 1 } }, advisories: { one: {
  github_advisory_id: advisory, module_name: 'picomatch', patched_versions: '>=4.0.8',
  findings: [{ version: '4.0.5', dev: true, bundled: false, paths: ['.>vite>tinyglobby>picomatch', '.>vitest>@vitest/mocker>vite>picomatch'] }],
} } });

describe('dependency advisory acceptance follows the actual dev boundary', () => {
  it('accepts only the recorded, unpatched developer path', () => {
    expect(assessAudit(fixture(), policy, registry, now)).toEqual({ accepted: [advisory], rejected: [] });
  });
  it.each([
    ['production use', value => { value.findings[0].dev = false; }],
    ['new consumer', value => { value.findings[0].paths.push('.>server>picomatch'); }],
    ['new installed version', value => { value.findings[0].version = '4.0.7'; }],
    ['different advisory', value => { value.github_advisory_id = 'GHSA-other'; }],
    ['bundled library', value => { value.findings[0].bundled = true; }],
    ['missing dependency path', value => { value.findings[0].paths = []; }],
  ])('rejects %s', (_, mutate) => {
    const audit = fixture(); mutate(audit.advisories.one);
    expect(assessAudit(audit, policy, registry, now).accepted).toEqual([]);
    expect(assessAudit(audit, policy, registry, now).rejected).toHaveLength(1);
  });
  it('rejects a published fix, expired review and unavailable registry', () => {
    for (const versions of [{ '4.0.8': {} }, { '4.0.9': {} }, { '5.0.0': {} }]) {
      expect(assessAudit(fixture(), policy, { ...registry, versions }, now).rejected).toEqual([advisory]);
    }
    expect(assessAudit(fixture(), policy, registry, new Date('2026-12-18T00:00:00Z')).rejected).toEqual([advisory]);
    expect(assessAudit(fixture(), policy, undefined, now).rejected).toEqual([advisory]);
  });
  it('does not turn malformed audit output into a successful scan', () => {
    expect(() => assessAudit({}, policy, registry, now)).toThrow();
    expect(() => assessAudit({ advisories: {}, metadata: { vulnerabilities: { high: 1 } } }, policy, registry, now)).toThrow();
  });
});
