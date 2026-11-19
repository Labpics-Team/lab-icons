package pics.lab.icons

import androidx.compose.runtime.BroadcastFrameClock
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import pics.lab.icons.symbols.calendarNumber
import kotlin.test.*
import kotlin.time.Instant

class CalendarPaintTest {
    private fun raster(paints: List<PreparedPaint>, background: Color = Color.Transparent): IntArray {
        val bitmap = ImageBitmap(96, 96)
        val layers = prepareLayers(paints)
        CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, Canvas(bitmap), Size(96f, 96f)) {
            drawRect(background)
            scale(4f, 4f, pivot = Offset.Zero) { drawIconLayers(layers, Color(0xff23629c).copy(alpha = .55f)) }
        }
        return IntArray(96 * 96).also { bitmap.readPixels(it) }
    }

    @Test fun staticAndMountedDatePaintMatchAndApplyTranslucentTintOnce() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        for (day in listOf(1, 8, 10, 11, 28, 31)) for (variant in IconVariant.entries) {
            val symbol = resolveCalendarSymbol(calendarNumber, day)
            val static = prepareStaticSymbol(symbol, variant)
            val motion = IconMotion(calendarNumber, variant, scope, day)
            val animated = motion.paints.map { PreparedPaint(it) }
            for (weight in listOf(300f, 400f, 600f)) for (opsz in listOf(16f, 24f, 48f)) {
                static.forEach { it.update(weight, opsz) }
                animated.forEach { it.update(weight, opsz) }
                val pixels = raster(static)
                assertContentEquals(pixels, raster(animated), "$day/$variant/$weight/$opsz")
                assertTrue(pixels.any { it ushr 24 > 0 })
                assertTrue(pixels.all { it ushr 24 <= 141 }, "Tint applied more than once")
                assertTrue(raster(animated, Color.White).all { it ushr 24 == 255 }, "Subtraction reached the background")
            }
            motion.dispose()
        }
        scope.cancel()
    }

    @Test fun dateCrossfadeKeepsCoverageWhenTheFirstPartIsNotTheMostVisible() = runTest {
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + BroadcastFrameClock())
        val motion = IconMotion(calendarNumber, IconVariant.Outline, scope, 28)
        val transition = motion.setDate(Instant.parse("2024-03-31T12:00:00Z"), "UTC", 1000)
        transition.pause(); transition.seek(500f)
        val prepared = motion.paints.map { PreparedPaint(it).apply { update(400f, 24f) } }
        val shellFirst = raster(prepared)
        val fadingFirst = prepared.sortedBy { it.paint.alphaValue }
        assertTrue(fadingFirst.first().paint.alphaValue < 1f)
        assertContentEquals(shellFirst, raster(fadingFirst), "Layer alpha must not depend on part order")
        transition.finish()
        val final = raster(prepared)
        assertFalse(final.contentEquals(shellFirst), "Date must visibly change during its transition")
        motion.dispose(); scope.cancel()
    }
}
