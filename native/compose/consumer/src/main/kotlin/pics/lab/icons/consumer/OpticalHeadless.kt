package pics.lab.icons.consumer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.runBlocking
import org.jetbrains.skia.EncodedImageFormat
import pics.lab.icons.Icon
import pics.lab.icons.IconMotion
import pics.lab.icons.IconVariant
import pics.lab.icons.rememberIconMotion
import pics.lab.icons.symbols.calendarNumber
import pics.lab.icons.symbols.checkmarkCircle
import pics.lab.icons.symbols.time
import pics.lab.icons.symbols.volumeHigh
import pics.lab.icons.states.statusStates
import pics.lab.motion.MotionResult
import java.io.File
import kotlin.time.Instant

/** Exercises only installed public API: complete rasters, interruption, recomposition and auto opsz. */
@OptIn(ExperimentalComposeUiApi::class)
fun headlessOpticalSmoke() = runBlocking {
    val controls = linkedMapOf<String, IconMotion>()
    val static = mutableStateOf(false)
    val seedWeight = mutableStateOf(300f)
    val date = Instant.parse("2024-03-11T12:00:00Z")
    val symbols = listOf(time, calendarNumber, checkmarkCircle, volumeHigh)
    val scene = ImageComposeScene(width = 720, height = 340) {
        Column(Modifier.fillMaxSize().background(Color(0xfff4f4f6)).padding(24.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            BasicText("Lab Icons · optical motion", style = TextStyle(Color(0xff17171b), 22.sp))
            for (variant in IconVariant.entries) Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                for (symbol in symbols) Column(Modifier.width(144.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    BasicText(symbol.id, style = TextStyle(Color(0xff626270), 12.sp))
                    val tint = Color(0xff215da0).copy(alpha = .55f)
                    val calendarDate = if (symbol === calendarNumber) date else null
                    val zone = if (calendarDate != null) "UTC" else null
                    val motion = rememberIconMotion(symbol, variant, calendarDate, zone, initialWeight = seedWeight.value, initialOpsz = 16f)
                    controls["${symbol.id}/$variant"] = motion
                    if (static.value) Icon(symbol, tint, variant = variant, size = 64.dp, weight = 450f, opsz = 32f, date = calendarDate, timeZone = zone)
                    else Icon(symbol, tint, size = 64.dp, motion = motion)
                }
            }
        }
    }
    fun frame(time: Long) = scene.render(time).use { image -> image.encodeToData(EncodedImageFormat.PNG)!!.use { it.bytes } }
    try {
        val initial = frame(0L)
        check(controls.size == 8)
        val identities = controls.values.toList()
        seedWeight.value = 500f
        check(initial.contentEquals(frame(16_000_000L))) { "Recomposition changed initial optical settings" }
        check(controls.values.toList() == identities)
        val outward = controls.values.map { it.setOptics(600f, 48f, 1000).also { it.pause() } }
        check(initial.contentEquals(frame(32_000_000L))) { "Starting optical motion changed the zero frame" }
        outward.forEach { it.seek(500f) }
        val middle = frame(48_000_000L)
        check(!initial.contentEquals(middle)) { "Optical motion did not change the raster" }
        val returning = controls.values.map { it.setOptics(450f, 32f, 1000).also { it.pause() } }
        check(middle.contentEquals(frame(64_000_000L))) { "Interrupted optical motion jumped" }
        outward.forEach { check(it.finished.await() == MotionResult.Stopped); it.finish() }
        check(middle.contentEquals(frame(80_000_000L))) { "Stale completion restored the old optical target" }
        returning.forEach { it.seek(500f) }
        File("build/native-icons-optical-headless.png").apply { parentFile.mkdirs(); writeBytes(frame(96_000_000L)) }
        returning.forEach { it.finish() }
        val completed = frame(112_000_000L)
        static.value = true
        check(completed.contentEquals(frame(128_000_000L))) { "Completed optical motion differs from a fresh static Icon" }
        println("Installed optical motion: eight symbols, zero frame, intermediate raster, interruption, stale completion and exact static endpoints")
    } finally { scene.close() }

    // Actual constraints and density, not the requested 96 dp, determine automatic optical size.
    val autoStatic = mutableStateOf(false)
    val autoScene = ImageComposeScene(width = 320, height = 96) {
        Row(Modifier.fillMaxSize().background(Color.White), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (density in listOf(1f, 2f)) CompositionLocalProvider(LocalDensity provides Density(density)) {
                Box(Modifier.size(32.dp)) {
                    val motion = rememberIconMotion(time, initialWeight = 600f)
                    if (autoStatic.value) Icon(time, Color.Black, size = 96.dp, weight = 600f, opsz = 32f)
                    else Icon(time, Color.Black, size = 96.dp, motion = motion)
                }
            }
            val stateMotion = rememberIconMotion(statusStates, initialWeight = 600f, initialOpsz = 32f, initialState = "increase")
            if (autoStatic.value) Icon(statusStates, Color.Black, size = 64.dp, weight = 600f, opsz = 32f, state = "increase")
            else Icon(statusStates, Color.Black, size = 64.dp, motion = stateMotion)
        }
    }
    fun autoFrame(time: Long) = autoScene.render(time).use { image -> image.encodeToData(EncodedImageFormat.PNG)!!.use { it.bytes } }
    try {
        val automatic = autoFrame(0L)
        autoStatic.value = true
        check(automatic.contentEquals(autoFrame(16_000_000L))) { "Auto opsz did not follow actual logical constraints independently of density" }
        println("Installed auto opsz: constrained 32 dp at density 1 and 2 matches explicit opsz 32")
        println("Installed initial named state: first mounted pose exactly matches static state")
    } finally { autoScene.close() }
}
