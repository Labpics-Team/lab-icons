import * as motion from '@labpics/motion';
import { createSymbolMotion, prepareContourStateEffect, type SymbolPlayback } from '@labpics/icons/motion';
import * as reload from '@labpics/icons/gestures/reload';
import * as orientation from '@labpics/icons/states/ellipsis-orientation-outline';
import { prepareBodyWidth } from '@labpics/icons/gestures/mic';
import { prepareClockHands } from '@labpics/icons/gestures/time';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const icons = createSymbolMotion(motion);
const container = (svg: string) => {
  const node = document.createElement('div');
  node.innerHTML = svg;
  document.body.append(node);
  return node;
};
const settle = async (controls: SymbolPlayback[], status: 'finished' | 'stopped') => {
  check((await Promise.all(controls.map(control => control.finished))).every(result => result.status === status), 'wrong completion');
};

async function verifyMotion() {
  const source = reload.renderMotionSvg();
  const rotation = reload.compileMotionEffect('reload.cycle', { duration: 1000 });
  check(source.ok && rotation.ok, 'reload preparation failed');
  const spinning = container(source.svg);
  const turn = icons.executeSymbolEffect(spinning, rotation.effect, { initialize: true });
  for (const control of turn) { control.pause(); control.seek(450); }
  check(turn.every(control => control.state === 'paused'), 'pause did not settle');
  for (const control of turn) control.stop();
  await settle(turn, 'stopped');
  const stoppedRotation = spinning.innerHTML;

  const dotsSource = orientation.renderStateSvg('horizontal');
  const vertical = orientation.compileStateEffect('vertical', { duration: 1000 });
  check(dotsSource.ok && vertical.ok, 'orientation preparation failed');
  const dots = container(dotsSource.svg);
  let progress = 0;
  const outbound = icons.executeSymbolEffect(dots, vertical.effect, {
    preparedContour: prepareContourStateEffect(vertical.effect), onProgress: value => { progress = value; },
  });
  outbound[0]!.pause(); outbound[0]!.seek(450); outbound[0]!.stop();
  await settle(outbound, 'stopped');
  const intermediate = dots.innerHTML;
  check(progress > 0 && progress < 1, 'no intermediate contour pose');
  const horizontal = orientation.compileStateEffect('horizontal', { duration: 700, from: progress });
  check(horizontal.ok, 'reverse preparation failed');
  const inbound = icons.executeSymbolEffect(dots, horizontal.effect, {
    preparedContour: prepareContourStateEffect(horizontal.effect),
  });
  check(dots.innerHTML === intermediate, 'reverse jumped away from visible pose');
  inbound[0]!.finish();
  await settle(inbound, 'finished');

  const width = prepareBodyWidth(), clock = prepareClockHands();
  check(width.ok && clock.ok, 'scalar preparation failed');
  const microphone = container(width.prepared.svg), time = container(clock.prepared.svg);
  const narrow = Math.max(width.prepared.domain.minimum, .8);
  const widthControls = icons.executePreparedWidth(microphone, width.prepared,
    { from: 1, to: narrow, duration: 300, reducedMotion: true });
  const clockControls = icons.executePreparedClock(time, clock.prepared,
    { from: 0, to: 1, duration: 300, reducedMotion: true });
  await settle([...widthControls, ...clockControls], 'finished');
  const expectedWidth = width.prepared.sample(narrow), expectedTime = clock.prepared.sample(1);
  check(expectedWidth.ok && expectedTime.ok, 'endpoint sampling failed');
  check(microphone.querySelector(width.prepared.renderTarget.selector)?.getAttribute('d') === expectedWidth.d, 'reduced width mismatch');
  check(time.querySelector(clock.prepared.renderTarget.selector)?.getAttribute('d') === expectedTime.d, 'reduced clock mismatch');

  const detached = container(clock.prepared.svg);
  const active = icons.executePreparedClock(detached, clock.prepared,
    { from: 0, to: 1, duration: 1000, reducedMotion: false });
  active[0]!.pause(); active[0]!.seek(250); active[0]!.stop();
  detached.remove();
  await settle(active, 'stopped');
  const retained = detached.innerHTML;
  await new Promise(resolve => setTimeout(resolve, 100));
  check(detached.innerHTML === retained && spinning.innerHTML === stoppedRotation, 'stopped writer changed its pose');
  return { rotation: 'paused-and-stopped', contour: 'interrupted-and-reversed',
    width: 'reduced-final', clock: 'reduced-final', removal: 'no-late-write' };
}
Object.assign(globalThis, { verifyMotion });
