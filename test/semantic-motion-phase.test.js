import { describe, expect, it } from 'vitest';
import { mountSymbol } from '../src/motion/symbol-state.ts';
import volume from '../dist/symbols/volume-high.js';
import checkmark from '../dist/symbols/checkmark.js';
import checkmarkCircle from '../dist/symbols/checkmark-circle.js';
import reload from '../dist/symbols/reload.js';
import direction from '../dist/states/direction.js';

class Element {
  constructor(tagName, document) { this.tagName = tagName; this.ownerDocument = document; this.attributes = new Map(); this.children = []; this.style = {}; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(child) { this.children.push(child); child.parent = this; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}
function scene(symbol, options) {
  const document = { createElementNS: (_, tag) => new Element(tag, document) };
  const root = new Element('div', document);
  // Only the clock is controlled. Every paint and phase write uses the production mounted renderer.
  const runtime = { value(initial) {
    let current = initial, playback;
    const listeners = new Set();
    const publish = value => { current = value; for (const listener of listeners) listener(value); };
    return { get: () => current, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      dispose: () => { listeners.clear(); playback?.stop(); },
      animate(to, { duration }) {
        const from = current; let complete;
        playback = { state: 'running', duration, finished: new Promise(resolve => { complete = resolve; }),
          pause() { this.state = 'paused'; }, play() { this.state = 'running'; },
          seek(time) { publish(from + (to - from) * time / duration); },
          finish() { publish(to); this.state = 'finished'; complete({ status: 'finished' }); },
          stop() { if (this.state !== 'finished') { this.state = 'stopped'; complete({ status: 'stopped' }); } },
        };
        return playback;
      },
    };
  } };
  return mountSymbol(runtime, root, symbol, options);
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
const paths = icon => icon.element.children.filter(element => element.tagName === 'path');
const opacity = (icon, part) => Number(paths(icon).find(path => path.getAttribute('data-part') === part).getAttribute('opacity'));
const drawOffset = icon => Number(icon.element.children[0].children[0].children[0].getAttribute('stroke-dashoffset'));

describe('semantic phase and visible intermediate poses', () => {
  it('restores the complete negative draw pose after an interrupted selected round trip without a jump', async () => {
    const icon = scene(checkmarkCircle, { state: 'selected' });
    const guide = descendants(icon.element).find(node => node.getAttribute('stroke-dashoffset') !== null);
    const counter = descendants(icon.element).find(node => node.getAttribute('data-part') === 'confirmation-mark');
    const draw = icon.effect('draw', { duration: 1000 }); draw.pause(); draw.seek(250);
    expect(guide.getAttribute('stroke-dashoffset')).toBe('0.75');
    const away = icon.setState('unselected', { duration: 1000 });
    expect(guide.getAttribute('stroke-dashoffset')).toBe('0.75');
    away.pause(); away.seek(500);
    const back = icon.setState('selected', { duration: 1000 });
    expect(guide.getAttribute('stroke-dashoffset')).toBe('0.75');
    back.pause(); back.seek(500);
    expect(guide.getAttribute('stroke-dashoffset')).toBe('0.375');
    back.finish(); await back.finished;
    expect(guide.getAttribute('stroke-dashoffset')).toBe('0');
    expect(counter.getAttribute('mask')).toBe('');
    icon.dispose();
  });

  it('returns opacity, translation and rotation to the source pose continuously', async () => {
    for (const [symbol, effect, property, value] of [[volume, 'level', 'opacity', .5], [direction, 'nudge', 'transform'], [reload, 'cycle', 'transform']]) {
      const icon = scene(symbol);
      icon.effect(effect, { to: value, duration: 1000 }).seek(500);
      const before = paths(icon).map(path => path.getAttribute(property));
      const reset = icon.setState('unselected', { duration: 1000 }); reset.pause();
      expect(paths(icon).map(path => path.getAttribute(property))).toEqual(before);
      reset.seek(500);
      expect(paths(icon).map(path => path.getAttribute(property))).not.toEqual(before);
      reset.finish(); await reset.finished;
      for (const path of paths(icon)) {
        expect(path.getAttribute('opacity')).toBe('1');
        expect(path.getAttribute('transform')).toBe('translate(0 0) rotate(0 12 12)');
      }
      icon.dispose();
    }
  });

  it('lets an effect take its pose channel while the state finishes fading', () => {
    const icon = scene(checkmark);
    const first = icon.effect('draw', { duration: 1000 }); first.pause(); first.seek(250);
    const reset = icon.setState('unselected', { duration: 1000 }); reset.pause(); reset.seek(500);
    const reverse = icon.effect('draw', { to: 0, duration: 1000 }); reverse.pause(); reverse.seek(500);
    const visible = drawOffset(icon);
    reset.seek(750);
    expect(drawOffset(icon)).toBe(visible);
    reverse.finish(); reset.finish();
    expect(drawOffset(icon)).toBe(1);
    icon.dispose();
  });
  it('targets the incoming semantic key while both directions have the same part id', () => {
    const icon = scene(direction), left = paths(icon)[0];
    const change = icon.setState('right', { duration: 1000 }); change.pause(); change.seek(500);
    const right = paths(icon).find(path => path !== left);
    const nudge = icon.effect('nudge', { duration: 1000 }); nudge.pause(); nudge.seek(500);
    expect(left.getAttribute('transform')).toContain('translate(0 0)');
    expect(right.getAttribute('transform')).toContain('translate(3 0)');
    icon.dispose();
  });

  it('decreases a full level from rest and retargets from the currently displayed phase', () => {
    const icon = scene(volume);
    const first = icon.effect('level', { to: .8, duration: 1000 }); first.pause();
    expect(opacity(icon, 'wave-far')).toBe(1);
    for (const time of [0, 250, 500, 750]) {
      first.seek(time);
      expect(opacity(icon, 'wave-far')).toBeCloseTo(1 - .6 * time / 1000, 8);
      expect(opacity(icon, 'wave-middle')).toBe(1);
    }
    first.seek(500);
    const next = icon.effect('level', { to: .7, duration: 1000 }); next.pause(); next.seek(500);
    expect(opacity(icon, 'wave-far')).toBeCloseTo(.4, 8);
    icon.dispose();
  });

  it('honors an explicit partial draw endpoint without resetting the complete source pose', () => {
    const icon = scene(checkmark);
    const explicit = icon.effect('draw', { to: .5, duration: 1000 });
    expect(paths(icon)[0].getAttribute('mask')).toBe('');
    explicit.pause(); explicit.seek(500);
    expect(drawOffset(icon)).toBe(.25);
    explicit.seek(750);
    const reverse = icon.effect('draw', { to: .25, duration: 1000 }); reverse.pause(); reverse.seek(500);
    expect(drawOffset(icon)).toBe(.5625);
    icon.dispose();
  });

  it('replays draw after every completed gesture and keeps the guide mask active at half time', async () => {
    const icon = scene(checkmark);
    for (let iteration = 0; iteration < 3; iteration++) {
      const play = icon.effect('draw', { duration: 1000 }); play.pause(); play.seek(500);
      expect(drawOffset(icon)).toBe(.5);
      expect(paths(icon)[0].getAttribute('mask')).toMatch(/^url\(/);
      play.finish(); await play.finished;
    }
    icon.dispose();
  });
});
