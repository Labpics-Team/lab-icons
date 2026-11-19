package pics.lab.icons.consumer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.runBlocking
import org.jetbrains.skia.EncodedImageFormat
import pics.lab.icons.Icon
import pics.lab.icons.IconMotion
import pics.lab.icons.IconVariant
import pics.lab.icons.rememberIconMotion
import pics.lab.icons.symbols.calendarNumber
import pics.lab.motion.MotionResult
import java.io.File
import kotlin.time.Instant

/** Installed artifacts, real Compose raster, no window, desktop capture, clock or audio. */
@OptIn(ExperimentalComposeUiApi::class)
fun headlessCalendarSmoke() = runBlocking {
    val controls = linkedMapOf<String, IconMotion>()
    val initialDate = mutableStateOf(Instant.parse("2024-03-01T12:00:00Z"))
    val supports = listOf(300f to 16f, 300f to 48f, 400f to 24f, 450f to 32f, 600f to 16f, 600f to 48f)
    val days = listOf(1, 8, 10, 11, 28, 31)
    val scene = ImageComposeScene(width = 880, height = 1240) {
        Column(Modifier.fillMaxSize().background(Color(0xfff4f4f6)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            BasicText("Lab Icons · calendar · static / motion", style = TextStyle(Color(0xff17171b), 22.sp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Spacer(Modifier.width(120.dp))
                days.forEach { BasicText(it.toString(), Modifier.width(104.dp), TextStyle(Color(0xff626270), 16.sp)) }
            }
            for (variant in IconVariant.entries) {
                BasicText(variant.name, style = TextStyle(Color(0xff17171b), 18.sp))
                for ((weight, opsz) in supports) Row(Modifier.height(76.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    BasicText("${weight.toInt()} / ${opsz.toInt()}", Modifier.width(120.dp), TextStyle(Color(0xff626270), 14.sp))
                    for (day in days) Row(Modifier.width(104.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val date = Instant.parse("2024-03-${day.toString().padStart(2, '0')}T12:00:00Z")
                        val tint = Color(0xff215da0).copy(alpha = .55f)
                        Icon(calendarNumber, tint, variant = variant, size = 48.dp, weight = weight, opsz = opsz, date = date, timeZone = "UTC")
                        val seed = if (variant == IconVariant.Outline && weight == 300f && opsz == 16f && day == 1) initialDate.value else date
                        val motion = rememberIconMotion(calendarNumber, variant, initialDate = seed, initialTimeZone = "UTC",
                            initialWeight = weight, initialOpsz = opsz)
                        controls["$variant/$weight/$opsz/$day"] = motion
                        Icon(calendarNumber, tint, size = 48.dp, motion = motion)
                    }
                }
            }
        }
    }
    fun frame(time: Long) = scene.render(time).use { image ->
        image.encodeToData(EncodedImageFormat.PNG)!!.use { it.bytes }
    }
    try {
        frame(0L)
        check(controls.size == 72)
        val first = controls.values.first()
        first.setState("selected", 0).finish()
        first.setDate(Instant.parse("2024-03-08T12:00:00Z"), "UTC", 0).finish()
        val beforeInitialChange = frame(16_000_000L)
        initialDate.value = Instant.parse("2024-03-31T12:00:00Z")
        val afterInitialChange = frame(32_000_000L)
        check(controls.values.first() === first)
        check(beforeInitialChange.contentEquals(afterInitialChange)) { "Recomposition replaced the controller's date or selected state" }
        val away = first.setDate(Instant.parse("2024-03-31T12:00:00Z"), "UTC", 1000)
        away.pause(); away.seek(450f)
        val back = first.setDate(Instant.parse("2024-03-01T00:30:00Z"), "America/Los_Angeles", 1000)
        check(away.finished.await() == MotionResult.Stopped)
        back.pause(); back.seek(500f); back.finish()
        first.setState("unselected", 0).finish()
        first.setDate(Instant.parse("2024-03-01T12:00:00Z"), "UTC", 0).finish()
        val file = File("build/native-icons-calendar-headless.png").apply { parentFile.mkdirs() }
        file.writeBytes(frame(48_000_000L))
        val removed = first.setDate(Instant.parse("2024-03-28T12:00:00Z"), "UTC")
        first.dispose()
        check(removed.finished.await() == MotionResult.Stopped)
        println("Installed calendar: 72 static/motion pairs, preserved controller/date/selection across recomposition, interrupted day change and disposal. Image: ${file.absolutePath}")
    } finally { scene.close() }
}
