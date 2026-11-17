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

/** Immutable compiled family. Numeric buffers remain private to the renderer. */
@Immutable
public class SymbolData internal constructor(
    public val id: String,
    public val axes: IconAxes,
    internal val variants: Array<SymbolVariantData>,
)

internal class SymbolVariantData(val paths: Array<SymbolPathData>, val parts: Array<SymbolPartData>)
internal class SymbolPartData(val id: String, val pathIndex: Int, val contourIndices: IntArray)
internal class SymbolDelta(val term: Int, val indices: IntArray, val values: FloatArray)
internal class SymbolPathData(val commands: ByteArray, val coordinates: FloatArray, val evenOdd: Boolean, val terms: Array<SymbolDelta>) {
    fun sample(weightSide: Int, weight: Float, opticalSide: Int, optical: Float, target: FloatArray) {
        require(target.size == coordinates.size)
        coordinates.copyInto(target)
        val cross = 4 + weightSide * 2 + opticalSide
        for (delta in terms) {
            val factor = when {
                delta.term < 2 -> if (delta.term == weightSide) weight else 0f
                delta.term < 4 -> if (delta.term == 2 + opticalSide) optical else 0f
                delta.term == cross -> weight * optical
                else -> 0f
            }
            if (factor == 0f) continue
            for (index in delta.indices.indices) target[delta.indices[index]] += delta.values[index] * factor
        }
    }
}
