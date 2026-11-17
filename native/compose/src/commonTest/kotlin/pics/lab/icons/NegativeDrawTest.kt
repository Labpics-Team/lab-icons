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
import kotlinx.coroutines.test.runCurrent
import pics.lab.icons.symbols.checkmarkCircle
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertContentEquals

class NegativeDrawTest {
    private fun raster(background: Color = Color.Transparent, draw: DrawScope.() -> Unit): IntArray {
        val bitmap = ImageBitmap(96, 96)
        CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, Canvas(bitmap), Size(96f, 96f)) {
            drawRect(background)
            scale(4f, 4f, pivot = Offset.Zero, block = draw)
        }
        return IntArray(96 * 96).also { bitmap.readPixels(it) }
    }

    @Test fun fullSubtractivePaintPreservesStaticSilhouetteAtEveryOpticalSupport() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val motion = IconMotion(checkmarkCircle, IconVariant.Filled, scope)
        val prepared = motion.paints.map { PreparedPaint(it) }
        val layers = prepareLayers(prepared)
        assertEquals(1, layers.size)
        assertTrue(layers.single().isolated)
        assertEquals(1, prepared.count { it.paint.part.negative })
        val static = PreparedSymbol(checkmarkCircle, IconVariant.Filled)
        for (weight in listOf(300f, 400f, 600f)) for (opsz in listOf(16f, 24f, 48f)) {
            static.update(weight, opsz); prepared.forEach { it.update(weight, opsz) }
            for (phase in listOf(.99999f, 1f)) for (background in listOf(Color.Transparent, Color.White, Color(0xff252530))) {
                motion.effect("draw", to = phase, durationMillis = 0).finish()
                val tint = Color(0xff4581c4).copy(alpha = .55f)
                val expected = raster(background) { for (path in static.paths) drawPath(path, tint) }
                val actual = raster(background) { drawIconLayers(layers, tint) }
                var difference = 0.0
                for (index in actual.indices) for (shift in listOf(0, 8, 16, 24)) {
                    val alpha = (actual[index] ushr 24).toDouble() / 255
                    val referenceAlpha = (expected[index] ushr 24).toDouble() / 255
                    difference += abs(((actual[index] ushr shift) and 255) * (if (shift == 24) 1.0 else alpha) -
                        ((expected[index] ushr shift) and 255) * (if (shift == 24) 1.0 else referenceAlpha))
                }
                assertTrue(difference / (actual.size * 4) < .12,
                    "Static/motion mismatch at $weight/$opsz: average ${difference / (actual.size * 4)}")
            }
        }
        motion.dispose(); scope.cancel()
    }

    @Test fun guideGraduallyCutsTheHoleWithoutErasingTheConsumerBackground() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val motion = IconMotion(checkmarkCircle, IconVariant.Filled, scope)
        val prepared = motion.paints.map { PreparedPaint(it).apply { update(400f, 24f) } }
        val layers = prepareLayers(prepared)
        val totals = mutableListOf<Long>()
        for (phase in listOf(0f, .5f, 1f)) {
            motion.effect("draw", to = phase, durationMillis = 0).finish()
            val pixels = raster { drawIconLayers(layers, Color.Black) }
            totals.add(pixels.sumOf { (it ushr 24).toLong() })
            val background = raster(Color(0xffcc3355)) { drawIconLayers(layers, Color.Black) }
            assertTrue(background.all { (it ushr 24) == 255 }, "Subtraction erased the consumer background")
        }
        assertTrue(totals[0] > totals[1] && totals[1] > totals[2], "The authored guide must gradually reveal the hole")
        val replay = motion.effect("draw", durationMillis = 1000); replay.pause(); replay.seek(500f)
        val counter = motion.paints.single { it.part.negative }
        assertEquals(.5f, counter.draw.value)
        val reverse = motion.effect("draw", to = 0f, durationMillis = 1000); reverse.pause(); reverse.seek(500f)
        assertEquals(.25f, counter.draw.value)
        motion.dispose(); scope.cancel()
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test fun interruptedSelectionRestoresTheCompletePictureWithoutJumping() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val motion = IconMotion(checkmarkCircle, IconVariant.Filled, scope)
        val counter = motion.paints.single { it.part.negative }
        fun picture(): IntArray {
            val sources = mutableMapOf<SymbolPathData, PreparedPathSource>()
            val paints = motion.paints.map { PreparedPaint(it, sources.getOrPut(it.pathData) { PreparedPathSource(it.pathData) }).apply { update(400f, 24f) } }
            return raster { drawIconLayers(prepareLayers(paints), Color.Black) }
        }
        val complete = picture()
        val draw = motion.effect("draw", durationMillis = 1000); draw.pause(); draw.seek(250f)
        val away = motion.setState("unselected", 1000)
        assertEquals(.25f, counter.draw.value)
        away.pause(); away.seek(500f)
        val back = motion.setState("selected", 1000)
        assertEquals(.25f, counter.draw.value)
        back.pause(); back.seek(500f)
        assertEquals(.625f, counter.draw.value)
        back.finish(); runCurrent()
        assertEquals(1f, counter.draw.value)
        assertContentEquals(complete, picture())
        assertTrue(motion.paints.all { it.symbol.variants[it.variant.ordinal].motionPaths == null })
        assertTrue(motion.paints.all { it.part.pathIndex == 0 })
        motion.dispose(); scope.cancel()
    }
}
