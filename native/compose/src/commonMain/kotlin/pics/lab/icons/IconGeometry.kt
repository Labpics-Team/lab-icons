package pics.lab.icons

import androidx.compose.ui.geometry.Offset
import pics.lab.motion.MotionValue

/** One already resolved optical pose; correspondence is supplied by the compiled part key. */
internal class IconPartPose(val commands: ByteArray, val contours: IntArray, val evenOdd: Boolean,
    val points: FloatArray, var anchor: Offset, var offsetX: Float, var strokeWidth: Float?) {
    var revision = 0
}

internal fun sampleIconPose(symbol: SymbolData, variant: IconVariant, weight: Float, optical: Float): Map<String, IconPartPose> {
    val data = symbol.variants[variant.ordinal]
    val weightSide = if (weight < symbol.axes.weight.default) 0 else 1
    val opticalSide = if (optical < symbol.axes.opsz.default) 0 else 1
    val weightAt = symbol.axes.weight.position(weight)
    val opticalAt = symbol.axes.opsz.position(optical)
    val sampled = mutableMapOf<SymbolPathData, FloatArray>()
    return data.parts.associate { part ->
        val path = (data.motionPaths ?: data.paths)[part.pathIndex]
        val source = sampled.getOrPut(path) {
            FloatArray(path.coordinates.size).also { path.sample(weightSide, weightAt, opticalSide, opticalAt, it) }
        }
        val points = part.geometry?.let { view -> FloatArray(view.points.size * 2).also { view.sample(source, it) } } ?: source
        part.key to IconPartPose(part.geometry?.commands ?: path.commands,
            if (part.geometry == null) part.contourIndices else IntArray(0), path.evenOdd, points,
            part.pivot?.let { Offset(it.sample(source, 0), it.sample(source, 1)) } ?: Offset(part.anchorX, part.anchorY),
            part.offsetX?.sample(weightSide, weightAt, opticalSide, opticalAt) ?: 0f,
            path.strokeWidth?.sample(weightSide, weightAt, opticalSide, opticalAt))
    }
}

/** Captures visible geometry once. Sampling reuses its output buffer and preserves exact endpoints. */
internal fun interpolateIconGeometry(first: IconPartPose, last: IconPartPose, startProgress: Float = 0f): IconGeometryTransition? {
    if (first.commands.contentEquals(last.commands) && first.contours.contentEquals(last.contours) &&
        first.evenOdd == last.evenOdd && first.points.contentEquals(last.points) && first.anchor == last.anchor &&
        first.offsetX == last.offsetX && first.strokeWidth == last.strokeWidth) return null
    return IconGeometryTransition(first, last, startProgress)
}

internal class IconGeometryTransition(first: IconPartPose, private val last: IconPartPose,
    private val startProgress: Float = 0f) {
    private val source = first.points.copyOf()
    private val startAnchor = first.anchor
    private val startOffset = first.offsetX
    private val startWidth = first.strokeWidth
    private val value = IconPartPose(last.commands, last.contours, last.evenOdd, source.copyOf(), startAnchor, startOffset, startWidth)
    private var previous = Float.NaN
    init {
        require(first.commands.contentEquals(last.commands) && first.contours.contentEquals(last.contours) &&
            first.evenOdd == last.evenOdd && first.points.size == last.points.size &&
            (first.strokeWidth == null) == (last.strokeWidth == null)) { "A shared symbol part requires compatible path topology" }
    }
    fun sample(progress: Float): IconPartPose {
        val at = if (startProgress == 1f) 1f else ((progress - startProgress) / (1f - startProgress)).coerceIn(0f, 1f)
        if (at == previous) return value
        for (i in source.indices) value.points[i] = mix(source[i], last.points[i], at)
        value.anchor = Offset(mix(startAnchor.x, last.anchor.x, at), mix(startAnchor.y, last.anchor.y, at))
        value.offsetX = mix(startOffset, last.offsetX, at)
        if (startWidth != null) value.strokeWidth = mix(startWidth, last.strokeWidth!!, at)
        previous = at; value.revision++
        return value
    }
    private fun mix(a: Float, b: Float, at: Float) = when (at) { 0f -> a; 1f -> b; else -> a + (b - a) * at }
}

internal class IconPaintGeometry(val target: IconPartPose, private val progress: MotionValue,
    val transition: IconGeometryTransition? = null) {
    fun current(): IconPartPose {
        // Observe the shared progress even at rest, before the first transition exists.
        val at = progress.value
        return transition?.sample(at) ?: target
    }
}
