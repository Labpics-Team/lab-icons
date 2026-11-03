import { describe, expect, it, vi } from 'vitest';
import { executeLabMotion } from '../scripts/bench/browser-scene.js';

// Подмена только на границе Motion: DOM предоставляет binding/style, executor — controls.
function createScene(count, { missing, extraTarget = false } = {}) {
  const targets = [
    { partId: 'hand-hour', style: { transformOrigin: '12px 12px', transformBox: 'view-box' }, rotation: { from: 15, to: 90 } },
    { partId: 'hand-minute', style: { transformOrigin: '11px 13px', transformBox: 'view-box' }, rotation: { from: 25, to: 270 } },
    ...(extraTarget ? [{ partId: 'marker', style: { transformOrigin: '8px 8px', transformBox: 'view-box' }, rotation: { from: 0, to: -45 } }] : []),
  ];
  const bindings = [], writes = [], nodesByPart = new Map(targets.map(target => [target.partId, []]));
  const roots = Array.from({ length: count }, (_, rootIndex) => {
    const nodes = new Map(targets.map(target => {
      const node = {
        rootIndex, partId: target.partId, playback: [],
        style: new Proxy({ opacity: '0.8' }, {
          set(style, key, value) { writes.push({ rootIndex, partId: target.partId, key, value }); style[key] = value; return true; },
        }),
      };
      nodesByPart.get(target.partId).push(node);
      return [`[data-part="${target.partId}"]`, node];
    }));
    return {
      querySelector(selector) {
        bindings.push({ rootIndex, selector });
        const node = nodes.get(selector);
        return missing?.rootIndex === rootIndex && missing.partId === node?.partId ? null : node ?? null;
      },
    };
  });
  return { roots, nodesByPart, bindings, writes, effect: { targets, options: { duration: 360, easing: 'linear' } } };
}

function createControl(elements) {
  return {
    pause: vi.fn(() => elements.forEach(element => element.playback.push(['pause']))),
    seek: vi.fn(time => elements.forEach(element => element.playback.push(['seek', time]))),
    stop: vi.fn(() => elements.forEach(element => element.playback.push(['stop']))),
  };
}

function captureError(run) {
  try { run(); } catch (error) { return error; }
  throw new Error('Ожидался отказ executor');
}

describe('групповой Motion adapter внешнего benchmark consumer', () => {
  it.each([1, 3])('передаёт все %i экземпляров одним списком на semantic part', count => {
    const scene = createScene(count);
    const admitted = [];
    const animate = vi.fn((elements, properties, options) => {
      admitted.push({ elements, properties, options });
      return createControl(elements);
    });

    executeLabMotion(animate, scene.roots, scene.effect);

    expect(animate).toHaveBeenCalledTimes(2);
    expect(admitted[0]).toEqual({ elements: scene.nodesByPart.get('hand-hour'), properties: { rotate: 90 },
      options: { duration: 360, ease: 'linear', reducedMotion: 'user' } });
    expect(admitted[1]).toEqual({ elements: scene.nodesByPart.get('hand-minute'), properties: { rotate: 270 },
      options: { duration: 360, ease: 'linear', reducedMotion: 'user' } });
    expect(new Set(admitted.flatMap(batch => batch.elements)).size).toBe(count * 2);
  });

  it('подготавливает binding и style всей сцены до первого admission', () => {
    const scene = createScene(3);
    const animate = vi.fn(elements => {
      expect(new Set(scene.bindings.map(binding => `${binding.rootIndex}:${binding.selector}`))).toEqual(new Set([
        '0:[data-part="hand-hour"]', '1:[data-part="hand-hour"]', '2:[data-part="hand-hour"]',
        '0:[data-part="hand-minute"]', '1:[data-part="hand-minute"]', '2:[data-part="hand-minute"]',
      ]));
      for (const target of scene.effect.targets) {
        for (const element of scene.nodesByPart.get(target.partId)) {
          expect(element.style).toEqual({ opacity: '0.8', ...target.style });
        }
      }
      return createControl(elements);
    });

    executeLabMotion(animate, scene.roots, scene.effect);

    expect(animate).toHaveBeenCalledTimes(2);
  });

  it.each([0, 220])('сохраняет duration=%i и easing, передавая reduced-motion policy', duration => {
    const scene = createScene(1);
    scene.effect.options = { duration, easing: 'ease-in-out' };
    const animate = vi.fn(elements => createControl(elements));

    executeLabMotion(animate, scene.roots, scene.effect);

    expect(animate).toHaveBeenCalledTimes(2);
    for (const [, , options] of animate.mock.calls) {
      expect(options).toEqual({ duration, ease: 'ease-in-out', reducedMotion: duration === 0 ? 'always' : 'user' });
    }
  });

  it('возвращает controls, управляющие каждой частью каждого экземпляра', () => {
    const scene = createScene(3);
    const admitted = [];
    const animate = vi.fn(elements => {
      const control = createControl(elements);
      admitted.push(control);
      return control;
    });

    const controls = executeLabMotion(animate, scene.roots, scene.effect);
    expect(controls).toHaveLength(2);
    expect(controls[0]).toBe(admitted[0]);
    expect(controls[1]).toBe(admitted[1]);
    for (const control of controls) { control.pause(); control.seek(90); control.stop(); }

    for (const nodes of scene.nodesByPart.values()) {
      for (const element of nodes) expect(element.playback).toEqual([['pause'], ['seek', 90], ['stop']]);
    }
  });

  it.each(['hand-hour', 'hand-minute'])('отказывает отсутствующей %s в позднем экземпляре до любого эффекта', partId => {
    const scene = createScene(3, { missing: { rootIndex: 2, partId } });
    const animate = vi.fn(elements => createControl(elements));

    expect(() => executeLabMotion(animate, scene.roots, scene.effect)).toThrow('не найден semantic part');

    expect(animate).not.toHaveBeenCalled();
    expect(scene.writes).toEqual([]);
    for (const nodes of scene.nodesByPart.values()) {
      for (const element of nodes) expect(element.style).toEqual({ opacity: '0.8' });
    }
  });

  it('при отказе позднего admission останавливает все принятые группы и сохраняет исходный error', () => {
    const scene = createScene(3, { extraTarget: true });
    const admissionError = new Error('Motion admission refused');
    const admitted = [];
    const animate = vi.fn(elements => {
      if (admitted.length === 2) throw admissionError;
      const control = createControl(elements);
      admitted.push(control);
      return control;
    });

    expect(captureError(() => executeLabMotion(animate, scene.roots, scene.effect))).toBe(admissionError);

    expect(animate).toHaveBeenCalledTimes(3);
    expect(admitted).toHaveLength(2);
    for (const control of admitted) expect(control.stop).toHaveBeenCalledOnce();
    for (const partId of ['hand-hour', 'hand-minute']) {
      for (const element of scene.nodesByPart.get(partId)) expect(element.playback).toEqual([['stop']]);
    }
    for (const element of scene.nodesByPart.get('marker')) expect(element.playback).toEqual([]);
  });

  it.each([1, 2])('cleanup с %i отказами продолжается, aggregate сохраняет исходный и cleanup errors', failures => {
    const scene = createScene(1, { extraTarget: true });
    const admissionError = new Error('Motion admission refused');
    const cleanupErrors = [new Error('hour cleanup refused'), new Error('minute cleanup refused')];
    const stops = [vi.fn(() => { throw cleanupErrors[0]; }), vi.fn(() => {
      if (failures === 2) throw cleanupErrors[1];
    })];
    let nextAdmission = 0;
    const animate = vi.fn(() => {
      if (nextAdmission === 2) throw admissionError;
      return { stop: stops[nextAdmission++] };
    });

    const error = captureError(() => executeLabMotion(animate, scene.roots, scene.effect));

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(1 + failures);
    expect(error.errors[0]).toBe(admissionError);
    for (let index = 0; index < failures; index++) expect(error.errors[index + 1]).toBe(cleanupErrors[index]);
    expect(animate).toHaveBeenCalledTimes(3);
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
  });
});
