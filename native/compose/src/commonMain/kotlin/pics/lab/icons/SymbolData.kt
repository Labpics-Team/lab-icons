package pics.lab.icons

import androidx.compose.runtime.Immutable

/** Logical design axis. The middle support is the unchanged author master. */
public data class IconAxis(public val minimum: Float, public val default: Float, public val maximum: Float) {
    init {
        require(minimum.isFinite() && default.isFinite() && maximum.isFinite() && minimum < default && default < maximum)
        require((default - minimum).isFinite() && (maximum - default).isFinite())
    }
    internal fun position(value: Float): Float {
        require(value.isFinite() && value in minimum..maximum) { "Icon axis must be between $minimum and $maximum" }
        return if (value < default) (default - value) / (default - minimum) else (value - default) / (maximum - default)
    }
}

public data class IconAxes(public val weight: IconAxis, public val opsz: IconAxis)
public enum class IconVariant { Outline, Filled }

internal class IconStateSelection(val symbol: SymbolData, val variant: IconVariant)
internal fun resolveIconState(symbol: SymbolData, variant: IconVariant, state: String?): IconStateSelection = when (state) {
    null -> IconStateSelection(symbol, variant)
    "selected" -> IconStateSelection(symbol, IconVariant.Filled)
    "unselected" -> IconStateSelection(symbol, IconVariant.Outline)
    else -> {
        require(symbol.states.containsKey(state)) { "Unknown icon state: $state" }
        IconStateSelection(symbol.states[state] ?: symbol, variant)
    }
}

/** Immutable compiled family. Numeric buffers remain private to the renderer. */
@Immutable
public class SymbolData internal constructor(
    public val id: String,
    public val axes: IconAxes,
    internal val variants: Array<SymbolVariantData>,
    internal val states: Map<String, SymbolData?> = emptyMap(),
    internal val calendar: CalendarSymbolData? = null,
)

internal class CalendarSymbolData(val key: String, val digits: Array<SymbolPathData>,
    val spacing: OpticalScalar, val shells: Array<Array<SymbolPartData>>)

internal class SymbolVariantData(val paths: Array<SymbolPathData>, val parts: Array<SymbolPartData>,
    val effects: Map<String, SymbolEffectData> = emptyMap(), val motionPaths: Array<SymbolPathData>? = null)
internal class SymbolPartData(val id: String, val pathIndex: Int, val contourIndices: IntArray,
    val key: String = id, val anchorX: Float = 12f, val anchorY: Float = 12f, val draw: SymbolDrawData? = null,
    val layer: String? = null, val negative: Boolean = false,
    val geometry: SymbolPathViewData? = null, val pivot: SymbolPointProjection? = null,
    val offsetX: OpticalScalar? = null)
internal class SymbolPointReference(val index: Int, val weights: FloatArray?)
internal class SymbolPointProjection(val basis: IntArray, val weights: FloatArray) {
    fun sample(source: FloatArray, axis: Int): Float = basis.indices.sumOf { (source[basis[it] * 2 + axis] * weights[it]).toDouble() }.toFloat()
}
internal class SymbolPathViewData(val commands: ByteArray, val basis: IntArray, val points: Array<SymbolPointReference>) {
    fun sample(source: FloatArray, target: FloatArray) {
        for (i in points.indices) for (axis in 0..1) {
            val point = points[i]
            target[i * 2 + axis] = if (point.weights == null) source[point.index * 2 + axis]
                else basis.indices.sumOf { (source[basis[it] * 2 + axis] * point.weights[it]).toDouble() }.toFloat()
        }
    }
}
internal class SymbolDrawData(val commands: ByteArray, val coordinates: FloatArray, val width: Float)
internal class SymbolEffectData(val duration: Int, val rest: Float, val tracks: Array<SymbolTrackData>, val elapsedHours: Boolean = false)
internal class SymbolTrackData(val partIndex: Int, val property: Int, val times: FloatArray, val values: FloatArray)
internal class SymbolDelta(val term: Int, val indices: IntArray, val values: FloatArray)
internal class OpticalScalar(val base: Float, val terms: IntArray, val deltas: FloatArray) {
    fun sample(weightSide: Int, weight: Float, opticalSide: Int, optical: Float): Float {
        var value = base
        for (index in terms.indices) value += deltas[index] * opticalTermFactor(terms[index], weightSide, weight, opticalSide, optical)
        return value
    }
    fun times(factor: Float) = OpticalScalar(base * factor, terms, FloatArray(deltas.size) { deltas[it] * factor })
}

private fun opticalTermFactor(term: Int, weightSide: Int, weight: Float, opticalSide: Int, optical: Float): Float = when {
    term < 2 -> if (term == weightSide) weight else 0f
    term < 4 -> if (term == 2 + opticalSide) optical else 0f
    term == 4 + weightSide * 2 + opticalSide -> weight * optical
    else -> 0f
}

internal class SymbolPathData(val commands: ByteArray, val coordinates: FloatArray, val evenOdd: Boolean,
    val terms: Array<SymbolDelta>, val strokeWidth: OpticalScalar? = null) {
    fun sample(weightSide: Int, weight: Float, opticalSide: Int, optical: Float, target: FloatArray) {
        require(target.size == coordinates.size)
        coordinates.copyInto(target)
        for (delta in terms) {
            val factor = opticalTermFactor(delta.term, weightSide, weight, opticalSide, optical)
            if (factor == 0f) continue
            for (index in delta.indices.indices) target[delta.indices[index]] += delta.values[index] * factor
        }
    }
}
