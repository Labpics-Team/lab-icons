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
import kotlin.time.Instant
import kotlin.math.ceil

/** Initial content and optical settings are read once; later edits use the controller. */
@Composable
public fun rememberIconMotion(symbol: SymbolData, variant: IconVariant = IconVariant.Outline,
    initialDate: Instant? = null, initialTimeZone: String? = null,
    initialWeight: Float = symbol.axes.weight.default, initialOpsz: Float? = null, initialState: String? = null): IconMotion {
    val scope = rememberCoroutineScope()
    val motion = remember(symbol, variant) {
        IconMotion(symbol, variant, scope, resolveCalendarRequest(symbol, initialDate, initialTimeZone), initialWeight, initialOpsz, initialState)
    }
    DisposableEffect(motion) { onDispose { motion.dispose() } }
    return motion
}

public class IconMotion internal constructor(
    private val base: SymbolData,
    private val initialVariant: IconVariant,
    private val scope: CoroutineScope,
    initialDay: Int? = null,
    initialWeight: Float = base.axes.weight.default,
    initialOpsz: Float? = null,
    initialState: String? = null,
) {
    private val controller = MotionController(scope)
    internal val paints = mutableStateListOf<IconPaint>()
    private val stored = mutableMapOf<String, IconPaint>()
    private val initialSelection = resolveIconState(base, initialVariant, initialState)
    private var currentSource = initialSelection.symbol
    private var day = initialDay
    private var current = resolveCalendarSymbol(currentSource, initialDay)
    private var variant = initialSelection.variant
    private var disposed = false
    private var epoch = 0
    private var cleanup: Job? = null
    private var stateRevision = 0
    private val phases = mutableMapOf<SymbolEffectData, IconEffectPhase>()
    private val opticalProgress = controller.value(1f)
    private var layoutOptical = base.axes.opsz.default
    private var playback: MotionPlayback? = null
    private var geometryEndMillis = 0f
    /** Requested optical settings. Null opsz follows the actual logical layout, without DPR. */
    public var weight: Float = initialWeight
        private set
    public var opsz: Float? = initialOpsz
        private set
    private var desired = current.variants[variant.ordinal].parts.map { it.key }.toSet()
    public var reducedMotion: Boolean
        get() = controller.reducedMotion
        set(value) { controller.reducedMotion = value }
    init {
        base.axes.weight.position(initialWeight); initialOpsz?.let { base.axes.opsz.position(it) }
        addPaints(current, variant, 1f)
    }

    /** Interpolates resolved geometry, including a previously interrupted optical pose. */
    public fun setOptics(weight: Float = this.weight, opsz: Float? = this.opsz, durationMillis: Int = 180): MotionPlayback {
        check(!disposed) { "Icon is disposed" }; require(durationMillis >= 0)
        base.axes.weight.position(weight); opsz?.let { base.axes.opsz.position(it) }
        ensureGeometry()
        this.weight = weight; this.opsz = opsz
        return transitionTo(current, variant, durationMillis, resetPose = true)
    }

    private fun ensureGeometry() {
        if (paints.none { it.geometry == null }) return
        val sources = mutableMapOf<Pair<SymbolData, IconVariant>, Map<String, IconPartPose>>()
        for (paint in paints) if (paint.geometry == null) {
            val poses = sources.getOrPut(paint.symbol to paint.variant) {
                sampleIconPose(paint.symbol, paint.variant, weight, opsz ?: layoutOptical)
            }
            paint.geometry = IconPaintGeometry(poses.getValue(paint.part.key), opticalProgress)
        }
    }

    /** Layout resolves auto opsz; it never creates a clock or a second user setting. */
    internal fun resolveLayout(logicalSize: Float) {
        val next = logicalSize.coerceIn(base.axes.opsz.minimum, base.axes.opsz.maximum)
        if (next != layoutOptical && opsz == null) {
            layoutOptical = next
            val sources = mutableMapOf<Pair<SymbolData, IconVariant>, Map<String, IconPartPose>>()
            for (paint in paints) {
                val target = sources.getOrPut(paint.symbol to paint.variant) {
                    sampleIconPose(paint.symbol, paint.variant, weight, next)
                }.getValue(paint.part.key)
                val previous = paint.geometry?.current()
                val transition = if (previous != null && opticalProgress.value < 1f)
                    interpolateIconGeometry(previous, target, opticalProgress.value) else null
                paint.geometry = IconPaintGeometry(target, opticalProgress, transition)
            }
        } else layoutOptical = next
        ensureGeometry()
    }

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
        val selection = resolveIconState(base, initialVariant, state)
        val resolved = resolveCalendarSymbol(selection.symbol, day)
        currentSource = selection.symbol
        return transitionTo(resolved, selection.variant, durationMillis, resetPose = true)
    }

    /** Change only calendar content. Variant/state and the shared shell keep their current pose. */
    public fun setDate(date: Instant, timeZone: String, durationMillis: Int = 180): MotionPlayback {
        check(!disposed) { "Icon is disposed" }; require(durationMillis >= 0)
        val nextDay = resolveCalendarRequest(base, date, timeZone)!!
        if (nextDay == day) return controller.animate { }
        val target = resolveCalendarSymbol(currentSource, nextDay)
        day = nextDay
        return transitionTo(target, variant, durationMillis, resetPose = false)
    }

    private fun transitionTo(target: SymbolData, selectedVariant: IconVariant, durationMillis: Int,
        resetPose: Boolean): MotionPlayback {
        val targetGeometry = sampleIconPose(target, selectedVariant, weight, opsz ?: layoutOptical)
        ensureGeometry()
        desired = target.variants[selectedVariant.ordinal].parts.map { it.key }.toSet()
        addPaints(target, selectedVariant, 0f)
        // Capture before resetting the shared progress. Outgoing parts retain their visible shape.
        for (paint in paints) {
            val first = paint.geometry?.current()
            val last = targetGeometry[paint.part.key]
            paint.geometry = if (last == null) IconPaintGeometry(first!!, opticalProgress)
                else IconPaintGeometry(last, opticalProgress, first?.let { interpolateIconGeometry(it, last) })
        }
        controller.animate { to(opticalProgress, 0f, MotionTransition.Tween(0)) }.finish()
        val playback = controller.animate {
            to(opticalProgress, 1f, MotionTransition.Tween(durationMillis, MotionEase.Linear))
            for (paint in paints) {
                val transition = MotionTransition.Tween(durationMillis, MotionEase.Linear)
                to(paint.alpha, if (paint.part.key in desired) 1f else 0f, transition)
                if (resetPose && paint.part.key in desired) {
                    to(paint.opacity, 1f, transition); to(paint.x, 0f, transition); to(paint.y, 0f, transition); to(paint.draw, 1f, transition)
                    to(paint.rotation, 0f, transition)
                }
            }
        }
        current = target; variant = selectedVariant; stateRevision++
        geometryEndMillis = durationMillis.toFloat()
        cleanAfter(playback)
        return playback
    }

    private fun cleanAfter(playback: MotionPlayback) {
        this.playback = playback
        cleanup?.cancel(); val generation = ++epoch
        cleanup = scope.launch {
            if (playback.finished.await() == MotionResult.Finished && generation == epoch) paints.removeAll { it.part.key !in desired }
        }
    }

    /** Explicit endpoints continue; omission replays a gesture or advances elapsed time by one hour. */
    public fun effect(name: String, to: Float? = null, durationMillis: Int? = null): MotionPlayback {
        check(!disposed) { "Icon is disposed" }; require(to == null || to.isFinite())
        val data = current.variants[variant.ordinal]
        val effect = requireNotNull(data.effects[name]) { "Unsupported icon effect: $name" }
        val duration = durationMillis ?: effect.duration; require(duration >= 0)
        val geometryRemaining = if (opticalProgress.value >= 1f) 0 else
            ceil((geometryEndMillis - (playback?.timeMillis ?: 0f)).coerceAtLeast(0f)).toInt()
        val phase = phases.getOrPut(effect) { IconEffectPhase(controller.value(effect.rest), -1) }
        // Linear tracks expose their current phase even while a state reset changes the pose.
        val reference = if (effect.elapsedHours) effect.tracks.firstOrNull { it.values.first() != it.values.last() } else null
        val currentPhase = if (reference != null) {
            val visible = paints.first { it.part.key == data.parts[reference.partIndex].key }.channel(reference.property).value
            (visible - reference.values.first()) / (reference.values.last() - reference.values.first())
        } else if (phase.revision == stateRevision) phase.value.value else null
        val endpoint = to ?: if (effect.elapsedHours) (currentPhase ?: effect.rest) + 1f else 1f
        require(endpoint.isFinite() && (effect.elapsedHours || endpoint in 0f..1f))
        val replay = !effect.elapsedHours && to == null && (currentPhase == null || currentPhase == 1f)
        val from = if (replay) 0f else currentPhase ?: effect.rest
        val bindings = effect.tracks.map { track ->
            val key = data.parts[track.partIndex].key
            val paint = paints.first { it.part.key == key }
            val value = paint.channel(track.property)
            val turn = !effect.elapsedHours && track.property == 3 && kotlin.math.abs(track.values.last() - track.values.first()) == 360f
            val base = sampleTrack(track, from, effect.elapsedHours)
            val start = if (replay && !turn) base else value.value
            val interior = track.times.indices.filter { !effect.elapsedHours && (if (endpoint > from) track.times[it] > from && track.times[it] < endpoint
                else track.times[it] < from && track.times[it] > endpoint) }.let { if (endpoint < from) it.reversed() else it }
            val points = interior.map { track.times[it] } + endpoint
            val times = points.map { if (endpoint == from) 1f else (it - from) / (endpoint - from) }
            val targets = points.mapIndexed { index, point -> sampleTrack(track, point, effect.elapsedHours) + (start - base) * (if (turn) 1f else 1f - times[index]) }
            require(targets.all { it.isFinite() })
            IconEffectBinding(value, start, targets, listOf(0f) + times)
        }
        if (phase.value.value != from || replay) {
            controller.animate {
                to(phase.value, from, MotionTransition.Tween(0))
                if (replay) for (binding in bindings) to(binding.value, binding.start, MotionTransition.Tween(0))
            }.finish()
        }
        phase.revision = stateRevision
        val playback = controller.animate {
            to(opticalProgress, 1f, MotionTransition.Tween(geometryRemaining, MotionEase.Linear))
            for (paint in paints) to(paint.alpha, if (paint.part.key in desired) 1f else 0f, MotionTransition.Tween(duration, MotionEase.Linear))
            to(phase.value, endpoint, MotionTransition.Tween(duration, MotionEase.Linear))
            for (binding in bindings) {
                if (binding.targets.size == 1) to(binding.value, binding.targets.single(), MotionTransition.Tween(duration, MotionEase.Linear))
                else keyframes(binding.value, binding.targets, duration, binding.times)
            }
        }
        geometryEndMillis = geometryRemaining.toFloat()
        cleanAfter(playback)
        return playback
    }

    public fun dispose() {
        if (disposed) return
        disposed = true; epoch++; cleanup?.cancel(); controller.dispose(); paints.clear(); stored.clear(); phases.clear()
    }
}

private class IconEffectPhase(val value: MotionValue, var revision: Int)
private class IconEffectBinding(val value: MotionValue, val start: Float, val targets: List<Float>, val times: List<Float>)

internal class IconPaint(override val symbol: SymbolData, override val variant: IconVariant, override val part: SymbolPartData,
    val alpha: MotionValue, val opacity: MotionValue, val x: MotionValue, val y: MotionValue,
    val rotation: MotionValue, val draw: MotionValue) : IconPaintState {
    override val pathData: SymbolPathData = symbol.variants[variant.ordinal].let { (it.motionPaths ?: it.paths)[part.pathIndex] }
    var geometry: IconPaintGeometry? = null
    override val alphaValue: Float get() = alpha.value
    override val opacityValue: Float get() = opacity.value
    override val xValue: Float get() = x.value
    override val yValue: Float get() = y.value
    override val rotationValue: Float get() = rotation.value
    override val drawValue: Float get() = draw.value
    fun channel(property: Int): MotionValue = when (property) { 0 -> opacity; 1 -> x; 2 -> y; 3 -> rotation; 4 -> draw; else -> error("Unknown icon channel") }
}

internal fun sampleTrack(track: SymbolTrackData, progress: Float, linear: Boolean = false): Float {
    if (linear) return track.values.first() + progress * (track.values.last() - track.values.first())
    if (progress <= 0) return track.values.first()
    for (index in 1 until track.times.size) if (progress <= track.times[index]) {
        val fraction = (progress - track.times[index - 1]) / (track.times[index] - track.times[index - 1])
        return track.values[index - 1] + (track.values[index] - track.values[index - 1]) * fraction
    }
    return track.values.last()
}
