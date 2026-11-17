package pics.lab.icons.consumer

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import kotlinx.coroutines.delay
import pics.lab.icons.Icon
import pics.lab.icons.IconVariant
import pics.lab.icons.rememberIconMotion
import pics.lab.icons.symbols.reload
import pics.lab.icons.symbols.checkmark
import pics.lab.icons.symbols.checkmarkCircle
import pics.lab.icons.symbols.volumeHigh
import pics.lab.icons.symbols.mic
import pics.lab.icons.states.microphoneStates
import pics.lab.icons.states.statusStates
import pics.lab.motion.MotionResult
import pics.lab.icons.symbols.cog
import pics.lab.icons.symbols.earth
import pics.lab.icons.symbols.layers
import pics.lab.icons.symbols.paw
import pics.lab.icons.symbols.plusCircle
import pics.lab.icons.symbols.star
import pics.lab.icons.consumer.generated.plusCircle as exportedPlusCircle
import java.awt.Rectangle
import java.awt.Robot
import java.io.File
import javax.imageio.ImageIO
import kotlin.concurrent.thread
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    check(exportedPlusCircle.id == plusCircle.id && exportedPlusCircle.axes == plusCircle.axes)
    if ("--headless" in args) { headlessSmoke(); headlessCalendarSmoke(); headlessOpticalSmoke(); return }
    val smoke = "--smoke" in args
    if (smoke) thread(name = "icons-consumer-deadline", isDaemon = true) {
        Thread.sleep(30_000)
        System.err.println("Native Icons consumer did not close within 30 seconds")
        exitProcess(1)
    }
    application {
        Window(onCloseRequest = ::exitApplication, title = "Lab Icons · Native", state = rememberWindowState(width = 1140.dp, height = 940.dp)) {
            var dark by remember { mutableStateOf(false) }
            var selected by remember { mutableStateOf(false) }
            var size by remember { mutableFloatStateOf(24f) }
            var weight by remember { mutableFloatStateOf(400f) }
            val ink = if (dark) Color(0xfff4f4f6) else Color(0xff17171b)
            val muted = if (dark) Color(0xffa2a2ab) else Color(0xff70707a)
            val background = if (dark) Color(0xff17171b) else Color(0xfffafafb)
            val surface = if (dark) Color(0xff292930) else Color(0xffededf1)
            val reloader = rememberIconMotion(reload)
            val confirmation = rememberIconMotion(statusStates)
            val drawn = rememberIconMotion(checkmark)
            val volume = rememberIconMotion(volumeHigh)
            val microphone = rememberIconMotion(microphoneStates)
            val negativeStart = rememberIconMotion(checkmarkCircle, IconVariant.Filled)
            val negativeMiddle = rememberIconMotion(checkmarkCircle, IconVariant.Filled)
            val negativeEnd = rememberIconMotion(checkmarkCircle, IconVariant.Filled)
            LaunchedEffect(Unit) {
                negativeStart.effect("draw", to = 0f, durationMillis = 0)
                negativeMiddle.effect("draw", to = .5f, durationMillis = 0)
            }
            Column(Modifier.fillMaxSize().background(background).padding(32.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                BasicText("Lab Icons", style = TextStyle(ink, 28.sp, FontWeight.SemiBold))
                BasicText("Один рисунок · вес и оптика · Outline и Filled", style = TextStyle(muted, 15.sp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Spacer(Modifier.width(180.dp))
                    for (variant in listOf("Outline", "Filled")) {
                        Column(Modifier.width(430.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            BasicText(variant, style = TextStyle(ink, 16.sp, FontWeight.Medium))
                            Row { for (label in listOf("16 · 300", "24 · 400", "48 · 600")) BasicText(label, Modifier.width(136.dp), TextStyle(muted, 12.sp)) }
                        }
                    }
                }
                for (symbol in listOf(exportedPlusCircle, paw, star, cog, earth, layers)) {
                    Row(Modifier.height(62.dp), verticalAlignment = Alignment.CenterVertically) {
                        BasicText(symbol.id, Modifier.width(180.dp), TextStyle(ink, 15.sp))
                        for (variant in IconVariant.entries) {
                            Row(Modifier.width(430.dp), verticalAlignment = Alignment.CenterVertically) {
                                for ((pixels, axisWeight) in listOf(16f to 300f, 24f to 400f, 48f to 600f)) {
                                    Row(Modifier.width(136.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Icon(symbol, ink, variant = variant, size = pixels.dp, weight = axisWeight)
                                        BasicText("Aa", style = TextStyle(ink, 14.sp, FontWeight(axisWeight.toInt())))
                                    }
                                }
                            }
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(Modifier.background(surface, RoundedCornerShape(10.dp)).clickable {
                        selected = !selected
                        size = if (selected) 32f else 24f
                        weight = if (selected) 600f else 400f
                    }.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(plusCircle, ink, variant = if (selected) IconVariant.Filled else IconVariant.Outline, size = size.dp, weight = weight)
                        BasicText("Выбрать", style = TextStyle(ink, 15.sp))
                    }
                    BasicText("Сменить тему", Modifier.clickable { dark = !dark }.padding(12.dp), TextStyle(ink, 15.sp))
                    BasicText("Размер и вес обновляют подготовленные контуры", style = TextStyle(muted, 13.sp))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(42.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(reload, ink, Modifier.clickable { reloader.effect("cycle") }, size = 48.dp, motion = reloader)
                    Icon(statusStates, ink, Modifier.clickable { confirmation.setState("increase") }, size = 48.dp, motion = confirmation)
                    Icon(checkmark, ink, Modifier.clickable { drawn.effect("draw") }, size = 48.dp, motion = drawn)
                    Icon(volumeHigh, ink, Modifier.clickable { volume.effect("level", to = .5f) }, size = 48.dp, motion = volume)
                    Icon(microphoneStates, ink, Modifier.clickable { microphone.setState("off") }, size = 48.dp, motion = microphone)
                    BasicText("Состояния · общие части · Motion · draw", style = TextStyle(muted, 13.sp))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicText("Filled draw", Modifier.width(156.dp), TextStyle(ink, 15.sp))
                    for ((label, iconMotion) in listOf("0" to negativeStart, "½" to negativeMiddle, "1" to negativeEnd)) {
                        Row(Modifier.background(Color(0xff658dc4), RoundedCornerShape(10.dp)).padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Icon(checkmarkCircle, Color.White.copy(alpha = .7f), size = 48.dp, variant = IconVariant.Filled, motion = iconMotion)
                            BasicText(label, style = TextStyle(Color.White, 13.sp))
                        }
                    }
                    BasicText("Прозрачное вычитание", style = TextStyle(muted, 13.sp))
                }
            }
            if (smoke) LaunchedEffect(Unit) {
                window.isAlwaysOnTop = true
                window.toFront()
                delay(250)
                selected = true; size = 48f; weight = 600f
                delay(120)
                selected = false; size = 16f; weight = 300f
                delay(120)
                selected = true; size = 24f; weight = 400f
                delay(180)
                val first = reloader.effect("cycle", durationMillis = 1000)
                first.pause(); first.seek(420f)
                val reverse = reloader.effect("cycle", to = 0f, durationMillis = 400)
                check(first.finished.await() == MotionResult.Stopped)
                reverse.finish(); check(reverse.finished.await() == MotionResult.Finished)
                val change = confirmation.setState("increase", 1000); change.pause(); change.seek(350f)
                val restore = confirmation.setState("confirmed", 500); restore.finish()
                val draw = drawn.effect("draw", durationMillis = 1000); draw.pause(); draw.seek(500f)
                val negative = negativeMiddle.effect("draw", to = 1f, durationMillis = 1000); negative.pause(); negative.seek(500f)
                val negativeReverse = negativeMiddle.effect("draw", to = 0f, durationMillis = 1000)
                check(negative.finished.await() == MotionResult.Stopped)
                negativeReverse.finish()
                negativeMiddle.effect("draw", to = .5f, durationMillis = 0).finish()
                volume.reducedMotion = true; volume.effect("level", to = .5f)
                microphone.reducedMotion = true; microphone.setState("off")
                delay(180)
                val content = window.contentPane
                val at = content.locationOnScreen
                val file = File("build/native-icons-consumer.png").apply { parentFile.mkdirs() }
                ImageIO.write(Robot().createScreenCapture(Rectangle(at.x, at.y, content.width, content.height)), "png", file)
                draw.stop()
                val removed = reloader.effect("cycle"); reloader.dispose()
                check(removed.finished.await() == MotionResult.Stopped)
                println("Installed native Icons + public Motion artifacts: rendered optical axes, reversed interrupted controls, retained shared state parts, drew guide mask, applied reduced motion and disposed active work. Screenshot: ${file.absolutePath}")
                exitApplication()
            }
        }
    }
}
