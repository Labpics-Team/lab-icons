package pics.lab.icons

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import kotlin.math.min

@Composable
internal fun MotionIcon(motion: IconMotion, tint: Color, modifier: Modifier, size: Dp, weight: Float,
    opsz: Float?, description: String?) {
    val sources = remember(motion) { mutableMapOf<SymbolPathData, PreparedPathSource>() }
    val prepared = motion.paints.map { paint -> remember(paint) {
        PreparedPaint(paint, sources.getOrPut(paint.pathData) { PreparedPathSource(paint.pathData) })
    } }
    PaintedIcon(prepared, tint, modifier, size, weight, opsz, description)
}

/** Both static and animated symbols use the same coverage, stroke and tint pipeline. */
@Composable
internal fun PaintedIcon(prepared: List<PreparedPaint>, tint: Color, modifier: Modifier, size: Dp,
    weight: Float, opsz: Float?, description: String?) {
    val layers = remember(prepared) { prepareLayers(prepared) }
    val currentTint by rememberUpdatedState(tint)
    val accessibility = if (description == null) Modifier else Modifier.semantics {
        contentDescription = description; role = Role.Image
    }
    Spacer(modifier.size(size).then(accessibility).drawWithCache {
        val logicalSize = min(this.size.width, this.size.height) / density
        for (paint in prepared) {
            val axis = paint.paint.symbol.axes.opsz
            paint.update(weight, opsz ?: logicalSize.coerceIn(axis.minimum, axis.maximum))
        }
        onDrawBehind {
            val edge = min(this.size.width, this.size.height)
            translate((this.size.width - edge) / 2, (this.size.height - edge) / 2) {
                scale(edge / 24f, edge / 24f, pivot = Offset.Zero) {
                    drawIconLayers(layers, currentTint)
                }
            }
        }
    })
}

/** One offscreen surface per declared coverage layer, never the consumer's background. */
internal class PreparedIconLayer(val paints: List<PreparedPaint>, val isolated: Boolean) {
    val bounds = Rect(-24f, -24f, 48f, 48f)
    val origin = Offset(-24f, -24f)
    val size = Size(72f, 72f)
    val composite = if (isolated) Paint() else null
}

internal fun prepareLayers(prepared: List<PreparedPaint>): List<PreparedIconLayer> {
    val layers = linkedMapOf<String, MutableList<PreparedPaint>>()
    for (entry in prepared) layers.getOrPut(entry.paint.part.layer ?: entry.paint.part.key) { mutableListOf() }.add(entry)
    return layers.values.map { entries -> PreparedIconLayer(entries.sortedBy { it.paint.part.negative }, entries.first().paint.part.layer != null) }
}

internal fun DrawScope.drawIconLayers(layers: List<PreparedIconLayer>, tint: Color) {
    for (layer in layers) {
        val groupAlpha = if (layer.isolated) layer.paints.maxOf { it.paint.alphaValue }.coerceIn(0f, 1f) else 1f
        if (groupAlpha <= 0f) continue
        if (layer.isolated) {
            layer.composite!!.alpha = groupAlpha
            drawContext.canvas.saveLayer(layer.bounds, layer.composite)
        }
        try {
            for (entry in layer.paints) {
                val paint = entry.paint
                val alpha = (paint.alphaValue / groupAlpha * paint.opacityValue).coerceIn(0f, 1f)
                val progress = paint.drawValue.coerceIn(0f, 1f)
                if (alpha <= 0f || progress <= 0f) continue
                val path = entry.geometry.path
                val mode = if (paint.part.negative) BlendMode.DstOut else BlendMode.SrcOver
                val color = if (paint.part.negative) Color.Black else if (layer.isolated) Color.White else tint
                translate(paint.xValue + entry.offsetX, paint.yValue) {
                    rotate(paint.rotationValue, entry.anchor) {
                        if (progress >= 1f || entry.measure == null) drawPath(path, color, alpha = alpha,
                            style = entry.pathStroke ?: Fill, blendMode = mode)
                        else {
                            entry.revealed.reset()
                            entry.measure.getSegment(0f, entry.measure.length * progress, entry.revealed)
                            clipPath(path) { drawPath(entry.revealed, color, alpha = alpha, style = entry.stroke!!, blendMode = mode) }
                        }
                    }
                }
            }
            if (layer.isolated) drawRect(tint, topLeft = layer.origin, size = layer.size, blendMode = BlendMode.SrcIn)
        } finally { if (layer.isolated) drawContext.canvas.restore() }
    }
}

internal interface IconPaintState {
    val symbol: SymbolData
    val variant: IconVariant
    val part: SymbolPartData
    val pathData: SymbolPathData
    val alphaValue: Float
    val opacityValue: Float
    val xValue: Float
    val yValue: Float
    val rotationValue: Float
    val drawValue: Float
}

internal class StaticIconPaint(override val symbol: SymbolData, override val variant: IconVariant,
    override val part: SymbolPartData) : IconPaintState {
    override val pathData = symbol.variants[variant.ordinal].let { (it.motionPaths ?: it.paths)[part.pathIndex] }
    override val alphaValue = 1f
    override val opacityValue = 1f
    override val xValue = 0f
    override val yValue = 0f
    override val rotationValue = 0f
    override val drawValue = 1f
}

internal fun prepareStaticSymbol(symbol: SymbolData, variant: IconVariant): List<PreparedPaint> {
    val sources = mutableMapOf<SymbolPathData, PreparedPathSource>()
    return symbol.variants[variant.ordinal].parts.map { part ->
        val paint = StaticIconPaint(symbol, variant, part)
        PreparedPaint(paint, sources.getOrPut(paint.pathData) { PreparedPathSource(paint.pathData) })
    }
}

internal class PreparedPaint(val paint: IconPaintState, private val source: PreparedPathSource = PreparedPathSource(paint.pathData)) {
    val geometry = PreparedPath(paint.pathData, paint.part.contourIndices, source, paint.part.geometry)
    var anchor = Offset(paint.part.anchorX, paint.part.anchorY)
        private set
    val stroke = paint.part.draw?.let { Stroke(it.width, cap = StrokeCap.Round, join = StrokeJoin.Round) }
    var pathStroke: Stroke? = null
        private set
    var offsetX = 0f
        private set
    private var previousWeight = Float.NaN
    private var previousOptical = Float.NaN
    fun update(weight: Float, optical: Float) {
        if (weight == previousWeight && optical == previousOptical) return
        val axes = paint.symbol.axes
        val weightSide = if (weight < axes.weight.default) 0 else 1
        val opticalSide = if (optical < axes.opsz.default) 0 else 1
        val weightAt = axes.weight.position(weight)
        val opticalAt = axes.opsz.position(optical)
        geometry.update(weightSide, weightAt, opticalSide, opticalAt)
        offsetX = paint.part.offsetX?.sample(weightSide, weightAt, opticalSide, opticalAt) ?: 0f
        paint.pathData.strokeWidth?.let {
            pathStroke = Stroke(it.sample(weightSide, weightAt, opticalSide, opticalAt), cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
        paint.part.pivot?.let { anchor = Offset(it.sample(source.points, 0), it.sample(source.points, 1)) }
        previousWeight = weight; previousOptical = optical
    }
    val revealed = Path()
    val measure: PathMeasure? = paint.part.draw?.let { guide ->
        val path = Path(); var cursor = 0; val points = guide.coordinates
        for (command in guide.commands) when (command.toInt()) {
            0 -> { path.moveTo(points[cursor], points[cursor + 1]); cursor += 2 }
            1 -> { path.lineTo(points[cursor], points[cursor + 1]); cursor += 2 }
            2 -> { path.cubicTo(points[cursor], points[cursor + 1], points[cursor + 2], points[cursor + 3], points[cursor + 4], points[cursor + 5]); cursor += 6 }
        }
        PathMeasure().apply { setPath(path, false) }
    }
}
