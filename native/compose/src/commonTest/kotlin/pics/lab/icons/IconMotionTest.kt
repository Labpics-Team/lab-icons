package pics.lab.icons

import androidx.compose.runtime.BroadcastFrameClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import pics.lab.icons.symbols.checkmark
import pics.lab.icons.states.statusStates
import pics.lab.icons.states.microphoneStates
import pics.lab.icons.states.directionStates
import pics.lab.icons.symbols.reload
import pics.lab.icons.symbols.volumeHigh
import pics.lab.motion.MotionResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class IconMotionTest {
    @Test fun explicitLevelUsesRestAndCurrentPhaseAtEveryIntermediateFrame() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val icon = IconMotion(volumeHigh, IconVariant.Outline, scope)
        val far = icon.paints.first { it.part.id == "wave-far" }
        val middle = icon.paints.first { it.part.id == "wave-middle" }
        val first = icon.effect("level", to = .8f, durationMillis = 1000)
        assertEquals(1f, far.opacity.value)
        first.pause()
        for (time in listOf(0f, 250f, 500f, 750f)) {
            first.seek(time)
            assertEquals(1f - .6f * time / 1000, far.opacity.value, .00001f)
            assertEquals(1f, middle.opacity.value, .00001f)
        }
        first.seek(500f)
        val next = icon.effect("level", to = .7f, durationMillis = 1000); next.pause(); next.seek(500f)
        assertEquals(.4f, far.opacity.value, .00001f)
        icon.dispose(); scope.cancel()
    }

    @Test fun explicitDrawContinuesFromRestAndOmittedEndpointReplaysRepeatedly() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val icon = IconMotion(checkmark, IconVariant.Outline, scope)
        val first = icon.effect("draw", to = .5f, durationMillis = 1000)
        assertEquals(1f, icon.paints.single().draw.value)
        first.pause(); first.seek(500f)
        assertEquals(.75f, icon.paints.single().draw.value)
        first.finish()
        icon.effect("draw", to = 1f, durationMillis = 0).finish()
        repeat(2) {
            val replay = icon.effect("draw", durationMillis = 1000); replay.pause(); replay.seek(500f)
            assertEquals(.5f, icon.paints.single().draw.value)
            replay.finish()
        }
        icon.dispose(); scope.cancel()
    }

    @Test fun directionGestureTargetsIncomingPartDuringStateReplacement() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val icon = IconMotion(directionStates, IconVariant.Outline, scope)
        val outgoing = icon.paints.single()
        val change = icon.setState("right", 1000); change.pause(); change.seek(500f)
        val incoming = icon.paints.first { it !== outgoing }
        val nudge = icon.effect("nudge", durationMillis = 1000); nudge.pause(); nudge.seek(500f)
        assertEquals(0f, outgoing.x.value)
        assertEquals(3f, incoming.x.value)
        icon.dispose(); scope.cancel()
    }

    @Test fun publicMotionRetargetsFromVisiblePoseAndDisposesItsClock() = runTest {
        val clock = BroadcastFrameClock()
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + clock)
        val icon = IconMotion(reload, IconVariant.Outline, scope)
        assertFalse(clock.hasAwaiters)
        val first = icon.effect("cycle", durationMillis = 1000)
        first.pause(); first.seek(420f)
        val visible = icon.paints.single().rotation.value
        assertEquals(151.2f, visible, .001f)
        val reverse = icon.effect("cycle", to = 0f, durationMillis = 400)
        assertEquals(visible, icon.paints.single().rotation.value)
        assertEquals(MotionResult.Stopped, first.finished.await())
        reverse.finish(); assertEquals(0f, icon.paints.single().rotation.value)
        icon.effect("cycle"); icon.dispose(); icon.dispose(); runCurrent()
        assertFalse(clock.hasAwaiters)
        scope.cancel()
    }

    @Test fun stateReversalKeepsSharedEnclosureAndReducedMotionResolvesImmediately() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val icon = IconMotion(statusStates, IconVariant.Outline, scope)
        val enclosure = icon.paints.first { it.part.id == "confirmation-enclosure" }
        val first = icon.setState("increase", 1000); first.pause(); first.seek(350f)
        val before = icon.paints.associate { it.part.key to it.alpha.value }
        val reverse = icon.setState("confirmed", 500)
        assertEquals(before, icon.paints.associate { it.part.key to it.alpha.value })
        assertTrue(icon.paints.any { it === enclosure })
        icon.reducedMotion = true; runCurrent()
        assertEquals(MotionResult.Finished, reverse.finished.await())
        assertEquals(2, icon.paints.size)
        icon.dispose(); scope.cancel()
    }

    @Test fun drawUsesAuthoredGuideAndLevelKeepsSpeakerOpaque() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val icon = IconMotion(checkmark, IconVariant.Outline, scope)
        val draw = icon.effect("draw", durationMillis = 1000); draw.pause(); draw.seek(500f)
        assertEquals(.5f, icon.paints.single().draw.value)
        assertTrue(icon.paints.single().part.draw!!.commands.size >= 3)
        val volume = IconMotion(volumeHigh, IconVariant.Outline, scope); volume.reducedMotion = true
        volume.effect("level", to = .5f)
        assertEquals(1f, volume.paints.first { it.part.id == "speaker" }.opacity.value)
        val microphone = IconMotion(microphoneStates, IconVariant.Outline, scope); microphone.reducedMotion = true
        microphone.setState("off"); runCurrent()
        assertTrue(microphone.paints.any { it.part.id == "muted-slash" && it.part.draw != null })
        icon.dispose(); volume.dispose(); microphone.dispose(); scope.cancel()
    }
}
