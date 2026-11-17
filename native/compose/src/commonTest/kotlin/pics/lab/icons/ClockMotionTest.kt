package pics.lab.icons

import androidx.compose.runtime.BroadcastFrameClock
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import pics.lab.icons.symbols.time
import pics.lab.icons.symbols.history
import pics.lab.motion.MotionResult
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ClockMotionTest {
    private fun raster(draw: DrawScope.() -> Unit): IntArray {
        val bitmap = ImageBitmap(96, 96)
        CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, Canvas(bitmap), Size(96f, 96f)) {
            drawRect(Color(0xffeeeeee)); scale(4f, 4f, pivot = Offset.Zero, block = draw)
        }
        return IntArray(96 * 96).also { bitmap.readPixels(it) }
    }

    @Test fun opticalRestIsTheStaticSilhouetteWithTranslucentTint() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        for (symbol in listOf(time, history)) for (variant in IconVariant.entries) {
            val motion = IconMotion(symbol, variant, scope)
            val sources = mutableMapOf<SymbolPathData, PreparedPathSource>()
            val paints = motion.paints.map { PreparedPaint(it, sources.getOrPut(it.pathData) { PreparedPathSource(it.pathData) }) }
            val layers = prepareLayers(paints)
            val static = PreparedSymbol(symbol, variant)
            val tint = Color(0xff3068a1).copy(alpha = .45f)
            for (weight in listOf(300f, 400f, 600f)) for (opsz in listOf(16f, 24f, 48f)) {
                paints.forEach { it.update(weight, opsz) }; static.update(weight, opsz)
                val expected = raster { static.paths.forEach { drawPath(it, tint) } }
                val actual = raster { drawIconLayers(layers, tint) }
                val difference = actual.indices.sumOf { index -> (0..2).sumOf { channel ->
                    abs(((actual[index] ushr (channel * 8)) and 255) - ((expected[index] ushr (channel * 8)) and 255))
                } }.toDouble() / (actual.size * 3)
                assertTrue(difference < .6, "${symbol.id}/$variant/$weight/$opsz changed the source silhouette: $difference")
                val hands = paints.filter { it.paint.part.geometry != null }
                assertEquals(hands[0].anchor, hands[1].anchor)
            }
            motion.dispose()
        }
        scope.cancel()
    }

    @Test fun elapsedHoursAdvanceReverseAndContinueFromTheVisiblePhase() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        for (symbol in listOf(time, history)) for (variant in IconVariant.entries) {
            val motion = IconMotion(symbol, variant, scope)
            val minute = motion.paints.first { it.part.id == "clock-minute" }.rotation
            val hour = motion.paints.first { it.part.id == "clock-hour" }.rotation
            val advance = motion.effect("advance", to = 2f, durationMillis = 1000); advance.pause(); advance.seek(250f)
            assertEquals(180f, minute.value); assertEquals(15f, hour.value)
            val reverse = motion.effect("advance", to = -1f, durationMillis = 1000)
            assertEquals(180f, minute.value); assertEquals(15f, hour.value)
            assertEquals(MotionResult.Stopped, advance.finished.await())
            reverse.pause(); reverse.seek(500f)
            assertEquals(-90f, minute.value); assertEquals(-7.5f, hour.value)
            reverse.finish()
            motion.effect("advance", durationMillis = 0).finish()
            assertEquals(0f, minute.value); assertEquals(0f, hour.value)
            motion.effect("advance", durationMillis = 0).finish()
            assertEquals(360f, minute.value); assertEquals(30f, hour.value)
            motion.setState("unselected", 0).finish()
            motion.dispose()
        }
        scope.cancel()
    }
}
