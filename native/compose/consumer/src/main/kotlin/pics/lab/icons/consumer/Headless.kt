package pics.lab.icons.consumer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicText
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
import pics.lab.icons.symbols.time
import pics.lab.icons.symbols.history
import pics.lab.motion.MotionResult
import java.io.File

/** ImageComposeScene renders the installed public artifacts without a window or desktop access. */
@OptIn(ExperimentalComposeUiApi::class)
fun headlessSmoke() = runBlocking {
    val controls = linkedMapOf<String, Pair<IconMotion, Float>>()
    val scene = ImageComposeScene(width = 640, height = 1180) {
        Column(Modifier.fillMaxSize().background(Color(0xfff4f4f6)).padding(24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            BasicText("Lab Icons · time / history", style = TextStyle(Color(0xff17171b), 22.sp))
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Spacer(Modifier.width(110.dp))
                for (label in listOf("Static", "0 h", "¼ h", "½ h", "1 h")) BasicText(label, Modifier.width(48.dp), TextStyle(Color(0xff626270), 14.sp))
            }
            for (symbol in listOf(time, history)) for (variant in IconVariant.entries) {
                BasicText("${symbol.id} · $variant", style = TextStyle(Color(0xff17171b), 16.sp))
                val supports = listOf(300f to 16f, 400f to 24f, 600f to 48f) +
                    if (symbol === history && variant == IconVariant.Outline) listOf(600f to 16f) else emptyList()
                for ((weight, opsz) in supports) {
                    Row(Modifier.height(52.dp), horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                        BasicText("${weight.toInt()} / ${opsz.toInt()}", Modifier.width(110.dp), TextStyle(Color(0xff626270), 14.sp))
                        val tint = Color(0xff215da0).copy(alpha = .55f)
                        Icon(symbol, tint, size = 48.dp, weight = weight, opsz = opsz, variant = variant)
                        for (phase in listOf(0f, .25f, .5f, 1f)) {
                            val motion = rememberIconMotion(symbol, variant, initialWeight = weight, initialOpsz = opsz)
                            controls["${symbol.id}/$variant/$weight/$opsz/$phase"] = motion to phase
                            Icon(symbol, tint, size = 48.dp, motion = motion)
                        }
                    }
                }
            }
        }
    }
    try {
        scene.render(0L).close()
        check(controls.size == 52)
        for ((motion, phase) in controls.values) motion.effect("advance", to = phase, durationMillis = 0).finish()
        val motion = controls.values.first().first
        val first = motion.effect("advance", to = 2f, durationMillis = 1000); first.pause(); first.seek(250f)
        val reverse = motion.effect("advance", to = -1f, durationMillis = 1000)
        check(first.finished.await() == MotionResult.Stopped)
        reverse.pause(); reverse.seek(500f); reverse.finish()
        motion.effect("advance", durationMillis = 0).finish()
        motion.effect("advance", to = 2f, durationMillis = 0).finish()
        val reset = motion.setState("unselected", 1000); reset.pause(); reset.seek(500f)
        val resumed = motion.effect("advance", durationMillis = 1000); resumed.pause(); resumed.seek(500f)
        reset.finish(); resumed.finish()
        motion.effect("advance", to = 0f, durationMillis = 0).finish()
        val file = File("build/native-icons-clock-headless.png").apply { parentFile.mkdirs() }
        scene.render(16_000_000L).use { image -> image.encodeToData(EncodedImageFormat.PNG)!!.use { file.writeBytes(it.bytes) } }
        val removed = motion.effect("advance"); motion.dispose()
        check(removed.finished.await() == MotionResult.Stopped)
        println("Installed Icons + public Motion: headless optical clock render, interrupted advance/reverse, implicit next hour, disposal. Image: ${file.absolutePath}")
    } finally { scene.close() }
}
