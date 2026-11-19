package pics.lab.icons

import androidx.compose.runtime.BroadcastFrameClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import pics.lab.icons.symbols.calendarNumber
import pics.lab.icons.symbols.checkmarkCircle
import pics.lab.icons.symbols.time
import pics.lab.icons.states.statusStates
import pics.lab.motion.MotionResult
import kotlin.test.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class OpticalMotionTest {
    private fun pose(motion: IconMotion) = motion.paints.associate { it.part.key to it.geometry!!.current() }
    private fun copy(source: IconPartPose) = IconPartPose(source.commands, source.contours, source.evenOdd,
        source.points.copyOf(), source.anchor, source.offsetX, source.strokeWidth)
    private fun assertMix(a: IconPartPose, b: IconPartPose, actual: IconPartPose, at: Float) {
        for (i in a.points.indices) assertEquals(a.points[i] + (b.points[i] - a.points[i]) * at, actual.points[i], .00001f, "coordinate $i")
        assertEquals(a.anchor.x + (b.anchor.x - a.anchor.x) * at, actual.anchor.x, .00001f)
        assertEquals(a.anchor.y + (b.anchor.y - a.anchor.y) * at, actual.anchor.y, .00001f)
        assertEquals(a.offsetX + (b.offsetX - a.offsetX) * at, actual.offsetX, .00001f)
        if (a.strokeWidth != null) assertEquals(a.strokeWidth!! + (b.strokeWidth!! - a.strokeWidth!!) * at, actual.strokeWidth!!, .00001f)
    }

    @Test fun opticalTransitionsMixEndpointGeometryAndContinueAfterInterruption() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        for (symbol in listOf(time, checkmarkCircle, calendarNumber)) for (variant in IconVariant.entries) {
            val day = if (symbol === calendarNumber) 11 else null
            val selected = resolveCalendarSymbol(symbol, day)
            val motion = IconMotion(symbol, variant, scope, day, 300f, 16f)
            motion.resolveLayout(48f)
            val start = sampleIconPose(selected, variant, 300f, 16f)
            val target = sampleIconPose(selected, variant, 600f, 48f)
            val first = motion.setOptics(600f, 48f, 1000)
            val firstBuffer = pose(motion).values.first().points
            for ((key, actual) in pose(motion)) assertMix(start.getValue(key), target.getValue(key), actual, 0f)
            first.pause()
            for (at in listOf(.125f, .437f, .75f)) {
                first.seek(at * 1000)
                for ((key, actual) in pose(motion)) assertMix(start.getValue(key), target.getValue(key), actual, at)
                assertSame(firstBuffer, pose(motion).values.first().points)
            }
            val interrupted = pose(motion).mapValues { copy(it.value) }
            val last = sampleIconPose(selected, variant, 450f, 32f)
            val second = motion.setOptics(450f, 32f, 1000)
            assertEquals(MotionResult.Stopped, first.finished.await())
            first.finish()
            for ((key, actual) in pose(motion)) assertContentEquals(interrupted.getValue(key).points, actual.points)
            second.pause(); second.seek(500f)
            for ((key, actual) in pose(motion)) assertMix(interrupted.getValue(key), last.getValue(key), actual, .5f)
            second.finish()
            for ((key, actual) in pose(motion)) {
                assertContentEquals(last.getValue(key).points, actual.points)
                assertEquals(last.getValue(key).anchor, actual.anchor)
                assertEquals(last.getValue(key).strokeWidth, actual.strokeWidth)
            }
            motion.dispose()
        }
        scope.cancel()
    }

    @Test fun autoOpticalSizeComesFromLogicalLayoutAndRebasesWithoutAVisibleJump() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val motion = IconMotion(time, IconVariant.Outline, scope)
        motion.resolveLayout(32f)
        val start = sampleIconPose(time, IconVariant.Outline, 400f, 32f)
        for ((key, actual) in pose(motion)) assertContentEquals(start.getValue(key).points, actual.points)
        val animation = motion.setOptics(weight = 600f, durationMillis = 1000)
        animation.pause(); animation.seek(500f)
        val visible = pose(motion).mapValues { copy(it.value) }
        motion.resolveLayout(96f) // clamps actual logical size to the authored domain, no density multiplication
        for ((key, actual) in pose(motion)) assertContentEquals(visible.getValue(key).points, actual.points)
        animation.finish()
        val target = sampleIconPose(time, IconVariant.Outline, 600f, 48f)
        for ((key, actual) in pose(motion)) assertContentEquals(target.getValue(key).points, actual.points)
        motion.setOptics(opsz = 24f, durationMillis = 0).finish()
        motion.resolveLayout(16f)
        val explicit = sampleIconPose(time, IconVariant.Outline, 600f, 24f)
        for ((key, actual) in pose(motion)) assertContentEquals(explicit.getValue(key).points, actual.points)
        motion.setOptics(opsz = null, durationMillis = 0).finish()
        val automatic = sampleIconPose(time, IconVariant.Outline, 600f, 16f)
        for ((key, actual) in pose(motion)) assertContentEquals(automatic.getValue(key).points, actual.points)
        motion.dispose(); scope.cancel()
    }

    @Test fun aGestureKeepsTheRemainingOpticalTransitionAndStateUsesTheSameTargetAxes() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val motion = IconMotion(time, IconVariant.Outline, scope, initialWeight = 300f, initialOpsz = 16f)
        motion.resolveLayout(24f)
        val from = sampleIconPose(time, IconVariant.Outline, 300f, 16f)
        val target = sampleIconPose(time, IconVariant.Outline, 600f, 48f)
        val optical = motion.setOptics(600f, 48f, 1000); optical.pause(); optical.seek(500f)
        val gesture = motion.effect("advance", to = 1f, durationMillis = 1000); gesture.pause(); gesture.seek(250f)
        for ((key, actual) in pose(motion)) assertMix(from.getValue(key), target.getValue(key), actual, .75f)
        optical.finish()
        gesture.seek(500f)
        for ((key, actual) in pose(motion)) assertContentEquals(target.getValue(key).points, actual.points)
        val state = motion.setState("selected", 0); state.finish(); runCurrent()
        val filled = sampleIconPose(time, IconVariant.Filled, 600f, 48f)
        for ((key, actual) in pose(motion)) assertContentEquals(filled.getValue(key).points, actual.points)
        motion.dispose(); scope.cancel()
    }

    @Test fun rejectedOpticsPreserveTheActiveOperationAndReducedMotionAndDisposeReleaseFrames() = runTest {
        val clock = BroadcastFrameClock()
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + clock)
        val motion = IconMotion(time, IconVariant.Outline, scope)
        motion.resolveLayout(24f); runCurrent(); assertFalse(clock.hasAwaiters)
        val first = motion.setOptics(600f, 48f, 1000); first.pause(); first.seek(300f)
        val before = pose(motion).mapValues { it.value.points.copyOf() }
        assertFailsWith<IllegalArgumentException> { motion.setOptics(Float.NaN) }
        assertFailsWith<IllegalArgumentException> { motion.setOptics(opsz = 15f) }
        assertFalse(first.finished.isCompleted)
        for ((key, actual) in pose(motion)) assertContentEquals(before.getValue(key), actual.points)
        motion.reducedMotion = true; runCurrent()
        assertEquals(MotionResult.Finished, first.finished.await()); assertFalse(clock.hasAwaiters)
        motion.reducedMotion = false
        val removed = motion.setOptics(300f, 16f, 1000)
        motion.dispose(); motion.dispose(); runCurrent()
        assertEquals(MotionResult.Stopped, removed.finished.await()); assertFalse(clock.hasAwaiters)
        scope.cancel()
    }

    @Test fun initialStateAndSubsequentOpticsShareTheStaticStateSelection() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        for (state in listOf("increase", "confirmed", "selected")) {
            val selection = resolveIconState(statusStates, IconVariant.Outline, state)
            val motion = IconMotion(statusStates, IconVariant.Outline, scope, initialState = state)
            motion.resolveLayout(24f)
            motion.setOptics(600f, 16f, 0).finish()
            val expected = sampleIconPose(selection.symbol, selection.variant, 600f, 16f)
            assertEquals(expected.keys, pose(motion).keys)
            for ((key, actual) in pose(motion)) assertContentEquals(expected.getValue(key).points, actual.points)
            motion.dispose()
        }
        assertFailsWith<IllegalArgumentException> { IconMotion(statusStates, IconVariant.Outline, scope, initialState = "missing") }
        scope.cancel()
    }
}
