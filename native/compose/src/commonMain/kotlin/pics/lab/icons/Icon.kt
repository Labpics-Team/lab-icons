package pics.lab.icons

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.time.Instant

/** size is already scaled logical size; null opsz follows the rendered logical size. */
@Composable
public fun Icon(
    symbol: SymbolData,
    tint: Color,
    modifier: Modifier = Modifier,
    variant: IconVariant = IconVariant.Outline,
    size: Dp = symbol.axes.opsz.default.dp,
    weight: Float? = null,
    opsz: Float? = null,
    contentDescription: String? = null,
    motion: IconMotion? = null,
    date: Instant? = null,
    timeZone: String? = null,
    state: String? = null,
) {
    require(size.value.isFinite() && size.value > 0) { "Icon size must be positive and finite" }
    weight?.let { symbol.axes.weight.position(it) }
    opsz?.let { symbol.axes.opsz.position(it) }
    if (motion != null) {
        require(date == null && timeZone == null) { "A motion controller owns the calendar date; use IconMotion.setDate" }
        require(weight == null && opsz == null) { "A motion controller owns optical axes; use initialWeight/initialOpsz and IconMotion.setOptics" }
        require(state == null) { "A motion controller owns the state; use initialState and IconMotion.setState" }
        MotionIcon(motion, tint, modifier, size, contentDescription)
        return
    }
    val day = remember(symbol, date, timeZone) { resolveCalendarRequest(symbol, date, timeZone) }
    val selection = remember(symbol, variant, state) { resolveIconState(symbol, variant, state) }
    val selected = remember(selection, day) { resolveCalendarSymbol(selection.symbol, day) }
    val prepared = remember(selected, selection.variant) {
        prepareStaticSymbol(selected, selection.variant)
    }
    PaintedIcon(prepared, tint, modifier, size, weight ?: symbol.axes.weight.default, opsz, contentDescription)
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
    sampled: PreparedPathSource? = null, private val view: SymbolPathViewData? = null) {
    val path = Path()
    private var sampled = sampled
    private var projected: FloatArray? = null
    val sourcePoints: FloatArray get() = sampled!!.points
    private var revision = -1
    private var pose: IconPartPose? = null
    private var poseRevision = -1
    fun update(weightSide: Int, weight: Float, opticalSide: Int, optical: Float) {
        val sampled = sampled ?: PreparedPathSource(source).also { this.sampled = it }
        sampled.update(weightSide, weight, opticalSide, optical)
        if (revision == sampled.revision) return
        revision = sampled.revision
        if (view != null) {
            val target = projected ?: FloatArray(view.points.size * 2).also { projected = it }
            view.sample(sampled.points, target)
        }
        val points = projected ?: sampled.points
        rebuild(view?.commands ?: source.commands, points, contours, source.evenOdd)
    }
    fun updatePose(next: IconPartPose) {
        if (pose === next && poseRevision == next.revision) return
        pose = next; poseRevision = next.revision
        rebuild(next.commands, next.points, next.contours, next.evenOdd)
    }
    private fun rebuild(commands: ByteArray, points: FloatArray, contours: IntArray, evenOdd: Boolean) {
        path.reset()
        path.fillType = if (evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
        var cursor = 0; var contour = -1
        for (command in commands) {
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
