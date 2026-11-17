package pics.lab.icons

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import pics.lab.motion.MotionController
import pics.lab.motion.MotionEase
import pics.lab.motion.MotionPlayback
import pics.lab.motion.MotionResult
import pics.lab.motion.MotionTransition
import pics.lab.motion.MotionValue

/** One controller per mounted icon. It creates no animation job until a state/effect is requested. */
@Composable
public fun rememberIconMotion(symbol: SymbolData, variant: IconVariant = IconVariant.Outline): IconMotion {
    val scope = rememberCoroutineScope()
    val motion = remember(symbol, variant) { IconMotion(symbol, variant, scope) }
    DisposableEffect(motion) { onDispose { motion.dispose() } }
    return motion
}

public class IconMotion internal constructor(
    private val base: SymbolData,
    private val initialVariant: IconVariant,
    private val scope: CoroutineScope,
) {
    private val controller = MotionController(scope)
    internal val paints = mutableStateListOf<IconPaint>()
    private val stored = mutableMapOf<String, IconPaint>()
    private var current = base
    private var variant = initialVariant
    private var disposed = false
    private var epoch = 0
    private var cleanup: Job? = null
    private var desired = base.variants[initialVariant.ordinal].parts.map { it.key }.toSet()
    public var reducedMotion: Boolean
        get() = controller.reducedMotion
        set(value) { controller.reducedMotion = value }
    init { addPaints(base, variant, 1f) }

    private fun addPaints(symbol: SymbolData, variant: IconVariant, alpha: Float) {
        for (part in symbol.variants[variant.ordinal].parts) {
            if (paints.any { it.part.key == part.key }) continue
            val paint = stored.getOrPut(part.key) { IconPaint(symbol, variant, part, controller.value(alpha), controller.value(1f),
                controller.value(0f), controller.value(0f), controller.value(0f), controller.value(1f)) }
            paints.add(paint)
        }
    }

    /** Selection switches the authored variant. Named states come from SymbolSource. */
    public fun setState(state: String, durationMillis: Int = 180): MotionPlayback {
        check(!disposed) { "Icon is disposed" }; require(durationMillis >= 0)
        val selectedVariant = when (state) { "selected" -> IconVariant.Filled; "unselected" -> IconVariant.Outline; else -> initialVariant }
        val target = when (state) {
            "selected", "unselected" -> base
            else -> { require(base.states.containsKey(state)) { "Unknown icon state: $state" }; base.states[state] ?: base }
        }
        desired = target.variants[selectedVariant.ordinal].parts.map { it.key }.toSet()
        addPaints(target, selectedVariant, 0f)
        val playback = controller.animate {
            for (paint in paints) {
                val transition = MotionTransition.Tween(durationMillis, MotionEase.Linear)
                to(paint.alpha, if (paint.part.key in desired) 1f else 0f, transition)
                if (paint.part.key in desired) {
                    to(paint.opacity, 1f, transition); to(paint.x, 0f, transition); to(paint.y, 0f, transition); to(paint.draw, 1f, transition)
                }
            }
        }
        current = target; variant = selectedVariant
        cleanAfter(playback)
        return playback
    }

    private fun cleanAfter(playback: MotionPlayback) {
        cleanup?.cancel(); val generation = ++epoch
        cleanup = scope.launch {
            if (playback.finished.await() == MotionResult.Finished && generation == epoch) paints.removeAll { it.part.key !in desired }
        }
    }

    /** Plays the declared gesture from visible values; a new effect replaces the previous control. */
    public fun effect(name: String, to: Float = 1f, durationMillis: Int? = null): MotionPlayback {
        check(!disposed) { "Icon is disposed" }; require(to.isFinite() && to in 0f..1f)
        val data = current.variants[variant.ordinal]
        val effect = requireNotNull(data.effects[name]) { "Unsupported icon effect: $name" }
        val duration = durationMillis ?: effect.duration; require(duration >= 0)
        val bindings = effect.tracks.map { track ->
            val key = data.parts[track.partIndex].key
            track to paints.first { it.part.key == key }
        }
        if (name == "draw" && to > 0f && bindings.all { it.second.draw.value >= 1f }) {
            controller.animate { for ((_, paint) in bindings) to(paint.draw, 0f, MotionTransition.Tween(0)) }.finish()
        }
        val playback = controller.animate {
            for (paint in paints) to(paint.alpha, if (paint.part.key in desired) 1f else 0f, MotionTransition.Tween(duration, MotionEase.Linear))
            for ((track, paint) in bindings) {
                val value = paint.channel(track.property)
                val offset = if (track.property == 3 && value.value >= 360f && to == 1f) value.value else 0f
                val end = sampleTrack(track, to) + offset
                val interior = track.times.indices.filter { track.times[it] > 0f && track.times[it] < to }
                if (interior.isEmpty() || to == 0f) to(value, end, MotionTransition.Tween(duration, MotionEase.Linear))
                else {
                    keyframes(value, interior.map { track.values[it] + offset } + end, duration,
                        listOf(0f) + interior.map { track.times[it] / to } + 1f)
                }
            }
        }
        cleanAfter(playback)
        return playback
    }

    public fun dispose() {
        if (disposed) return
        disposed = true; epoch++; cleanup?.cancel(); controller.dispose(); paints.clear(); stored.clear()
    }
}

internal class IconPaint(val symbol: SymbolData, val variant: IconVariant, val part: SymbolPartData,
    val alpha: MotionValue, val opacity: MotionValue, val x: MotionValue, val y: MotionValue,
    val rotation: MotionValue, val draw: MotionValue) {
    fun channel(property: Int): MotionValue = when (property) { 0 -> opacity; 1 -> x; 2 -> y; 3 -> rotation; 4 -> draw; else -> error("Unknown icon channel") }
}

internal fun sampleTrack(track: SymbolTrackData, progress: Float): Float {
    if (progress <= 0) return track.values.first()
    for (index in 1 until track.times.size) if (progress <= track.times[index]) {
        val fraction = (progress - track.times[index - 1]) / (track.times[index] - track.times[index - 1])
        return track.values[index - 1] + (track.values[index] - track.values[index - 1]) * fraction
    }
    return track.values.last()
}
