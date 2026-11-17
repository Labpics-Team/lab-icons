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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
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
    val prepared = motion.paints.map { paint -> remember(paint) { PreparedPaint(paint) } }
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
                    for (entry in prepared) {
                        val paint = entry.paint
                        val alpha = (paint.alpha.value * paint.opacity.value).coerceIn(0f, 1f)
                        val progress = paint.draw.value.coerceIn(0f, 1f)
                        if (alpha <= 0f || progress <= 0f) continue
                        val path = entry.geometry.path
                        translate(paint.x.value, paint.y.value) {
                            rotate(paint.rotation.value, Offset(paint.part.anchorX, paint.part.anchorY)) {
                                if (progress >= 1f || entry.measure == null) drawPath(path, currentTint, alpha = alpha)
                                else {
                                    entry.revealed.reset()
                                    entry.measure.getSegment(0f, entry.measure.length * progress, entry.revealed)
                                    clipPath(path) {
                                        drawPath(entry.revealed, currentTint, alpha = alpha,
                                            style = Stroke(paint.part.draw!!.width, cap = StrokeCap.Round, join = StrokeJoin.Round))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    })
}

private class PreparedPaint(val paint: IconPaint) {
    val geometry = PreparedPath(paint.symbol.variants[paint.variant.ordinal].paths[paint.part.pathIndex])
    private var previousWeight = Float.NaN
    private var previousOptical = Float.NaN
    fun update(weight: Float, optical: Float) {
        if (weight == previousWeight && optical == previousOptical) return
        val axes = paint.symbol.axes
        geometry.update(if (weight < axes.weight.default) 0 else 1, axes.weight.position(weight),
            if (optical < axes.opsz.default) 0 else 1, axes.opsz.position(optical))
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
