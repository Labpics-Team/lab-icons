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
    motion: IconMotion? = null,
) {
    require(size.value.isFinite() && size.value > 0) { "Icon size must be positive and finite" }
    symbol.axes.weight.position(weight)
    opsz?.let { symbol.axes.opsz.position(it) }
    if (motion != null) {
        MotionIcon(motion, tint, modifier, size, weight, opsz, contentDescription)
        return
    }
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
    private val prepared = Array(data.paths.size) { PreparedPath(data.paths[it]) }
    val paths = Array(data.paths.size) { prepared[it].path }
    private var previousWeight = Float.NaN
    private var previousOptical = Float.NaN

    fun update(weight: Float, optical: Float) {
        if (weight == previousWeight && optical == previousOptical) return
        val weightPosition = symbol.axes.weight.position(weight)
        val opticalPosition = symbol.axes.opsz.position(optical)
        val weightSide = if (weight < symbol.axes.weight.default) 0 else 1
        val opticalSide = if (optical < symbol.axes.opsz.default) 0 else 1
        for (path in prepared) path.update(weightSide, weightPosition, opticalSide, opticalPosition)
        previousWeight = weight
        previousOptical = optical
    }
}

/** One sampled buffer per source path in this icon, also when several parts select its contours. */
internal class PreparedPathSource(private val source: SymbolPathData) {
    val points = FloatArray(source.coordinates.size)
    var revision = 0
        private set
    private var lastWeightSide = -1
    private var lastOpticalSide = -1
    private var lastWeight = Float.NaN
    private var lastOptical = Float.NaN
    fun update(weightSide: Int, weight: Float, opticalSide: Int, optical: Float) {
        if (weightSide == lastWeightSide && opticalSide == lastOpticalSide && weight == lastWeight && optical == lastOptical) return
        source.sample(weightSide, weight, opticalSide, optical, points)
        lastWeightSide = weightSide; lastOpticalSide = opticalSide; lastWeight = weight; lastOptical = optical; revision++
    }
}

/** Commands already identify whole contours; selection needs no SVG parser or geometry operation. */
internal class PreparedPath(private val source: SymbolPathData, private val contours: IntArray = IntArray(0),
    private val sampled: PreparedPathSource = PreparedPathSource(source), private val view: SymbolPathViewData? = null) {
    val path = Path()
    private val projected = view?.let { FloatArray(it.points.size * 2) }
    private var revision = -1
    fun update(weightSide: Int, weight: Float, opticalSide: Int, optical: Float) {
        sampled.update(weightSide, weight, opticalSide, optical)
        if (revision == sampled.revision) return
        revision = sampled.revision
        if (projected != null) view!!.sample(sampled.points, projected)
        val points = projected ?: sampled.points
        path.reset()
        path.fillType = if (source.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
        var cursor = 0; var contour = -1
        for (command in view?.commands ?: source.commands) {
            if (command.toInt() == 0) contour++
            val selected = contours.isEmpty() || contour in contours
            when (command.toInt()) {
                0 -> { if (selected) path.moveTo(points[cursor], points[cursor + 1]); cursor += 2 }
                1 -> { if (selected) path.lineTo(points[cursor], points[cursor + 1]); cursor += 2 }
                2 -> { if (selected) path.cubicTo(points[cursor], points[cursor + 1], points[cursor + 2], points[cursor + 3], points[cursor + 4], points[cursor + 5]); cursor += 6 }
                3 -> if (selected) path.close()
                else -> error("Unknown compiled icon opcode")
            }
        }
    }
}
