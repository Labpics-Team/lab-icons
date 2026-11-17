package pics.lab.icons

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.min

/** size is already scaled logical size; null opsz follows the rendered logical size. */
@Composable
public fun Icon(
    symbol: SymbolData,
    tint: Color,
    modifier: Modifier = Modifier,
    variant: IconVariant = IconVariant.Outline,
    size: Dp = symbol.axes.opsz.default.dp,
    weight: Float = symbol.axes.weight.default,
    opsz: Float? = null,
    contentDescription: String? = null,
) {
    require(size.value.isFinite() && size.value > 0) { "Icon size must be positive and finite" }
    symbol.axes.weight.position(weight)
    opsz?.let { symbol.axes.opsz.position(it) }
    val prepared = remember(symbol, variant) { PreparedSymbol(symbol, variant) }
    val currentTint by rememberUpdatedState(tint)
    val accessibility = if (contentDescription == null) Modifier else Modifier.semantics {
        this.contentDescription = contentDescription
        role = Role.Image
    }
    Spacer(modifier.size(size).then(accessibility).drawWithCache {
        val logicalSize = min(this.size.width, this.size.height) / density
        val optical = opsz ?: logicalSize.coerceIn(symbol.axes.opsz.minimum, symbol.axes.opsz.maximum)
        prepared.update(weight, optical)
        onDrawBehind {
            val edge = min(this.size.width, this.size.height)
            val factor = edge / 24f
            translate((this.size.width - edge) / 2, (this.size.height - edge) / 2) {
                scale(factor, factor, pivot = androidx.compose.ui.geometry.Offset.Zero) {
                    for (path in prepared.paths) drawPath(path, currentTint)
                }
            }
        }
    })
}

/** One instance per Icon; changing an axis reuses all paths and coordinate buffers. */
internal class PreparedSymbol(private val symbol: SymbolData, variant: IconVariant) {
    private val data = symbol.variants[variant.ordinal]
    val paths = Array(data.paths.size) { Path() }
    private val coordinates = Array(data.paths.size) { FloatArray(data.paths[it].coordinates.size) }
    private var previousWeight = Float.NaN
    private var previousOptical = Float.NaN

    fun update(weight: Float, optical: Float) {
        if (weight == previousWeight && optical == previousOptical) return
        val weightPosition = symbol.axes.weight.position(weight)
        val opticalPosition = symbol.axes.opsz.position(optical)
        val weightSide = if (weight < symbol.axes.weight.default) 0 else 1
        val opticalSide = if (optical < symbol.axes.opsz.default) 0 else 1
        for (index in data.paths.indices) {
            val source = data.paths[index]
            val points = coordinates[index]
            source.sample(weightSide, weightPosition, opticalSide, opticalPosition, points)
            val target = paths[index]
            target.reset()
            target.fillType = if (source.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
            var cursor = 0
            for (command in source.commands) when (command.toInt()) {
                0 -> { target.moveTo(points[cursor], points[cursor + 1]); cursor += 2 }
                1 -> { target.lineTo(points[cursor], points[cursor + 1]); cursor += 2 }
                2 -> { target.cubicTo(points[cursor], points[cursor + 1], points[cursor + 2], points[cursor + 3], points[cursor + 4], points[cursor + 5]); cursor += 6 }
                3 -> target.close()
                else -> error("Unknown compiled icon opcode")
            }
        }
        previousWeight = weight
        previousOptical = optical
    }
}
