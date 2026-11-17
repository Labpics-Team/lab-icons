package pics.lab.icons

import androidx.compose.runtime.BroadcastFrameClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import pics.lab.icons.symbols.calendarNumber
import pics.lab.icons.symbols.checkmark
import pics.lab.motion.MotionResult
import kotlin.test.*
import kotlin.time.Instant

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class CalendarSymbolTest {
    @Test fun explicitZoneHandlesMidnightLeapDayAndDst() {
        val first = Instant.parse("2024-03-01T00:30:00Z")
        assertEquals(1, calendarDay(first, "UTC"))
        assertEquals(29, calendarDay(first, "America/Los_Angeles"))
        assertEquals(1, calendarDay(first, "Asia/Tokyo"))
        assertEquals(1, calendarDay(Instant.parse("2024-02-29T23:30:00Z"), "Asia/Tokyo"))
        for (instant in listOf("2024-03-10T09:59:00Z", "2024-03-10T10:01:00Z"))
            assertEquals(10, calendarDay(Instant.parse(instant), "America/Los_Angeles"))
        for (instant in listOf("2024-11-03T08:59:00Z", "2024-11-03T09:01:00Z"))
            assertEquals(3, calendarDay(Instant.parse(instant), "America/Los_Angeles"))
        for (zone in listOf("", "Invalid/Zone", "+01:00", "Z"))
            assertFailsWith<IllegalArgumentException> { calendarDay(first, zone) }
        assertFailsWith<IllegalArgumentException> { resolveCalendarRequest(calendarNumber, first, null) }
        assertFailsWith<IllegalArgumentException> { resolveCalendarRequest(calendarNumber, null, "UTC") }
        assertFailsWith<IllegalArgumentException> { resolveCalendarRequest(checkmark, first, "UTC") }
    }

    @Test fun allDigitsReuseTheSharedPathsAndAuthoredShell() {
        val calendar = assertNotNull(calendarNumber.calendar)
        assertEquals(10, calendar.digits.size)
        for (day in listOf(1, 8, 10, 11, 28, 31)) for (variant in IconVariant.entries) {
            val resolved = resolveCalendarSymbol(calendarNumber, day).variants[variant.ordinal]
            val shells = calendar.shells[variant.ordinal]
            shells.indices.forEach { assertSame(shells[it], resolved.parts[it]) }
            calendar.digits.indices.forEach { digit ->
                assertSame(calendar.digits[digit], resolved.paths[resolved.paths.size - 10 + digit])
            }
            val digits = resolved.parts.drop(shells.size)
            assertEquals(if (day < 10) 1 else 2, digits.size)
            assertTrue(digits.all { it.negative == (variant == IconVariant.Filled) })
            val offsets = digits.map { it.offsetX!!.sample(1, 0f, 1, 0f) }
            assertEquals(0f, offsets.sum())
            if (day >= 10) assertTrue(offsets.first() < 0 && offsets.last() > 0)
        }
        assertSame(calendarNumber, resolveCalendarSymbol(calendarNumber, null))
    }

    @Test fun dateRetargetKeepsSelectionShellAndVisibleCoverageWithoutClockUntilRequested() = runTest {
        val clock = BroadcastFrameClock()
        val scope = CoroutineScope(coroutineContext + Job(coroutineContext[Job]) + clock)
        val icon = IconMotion(calendarNumber, IconVariant.Outline, scope, 28)
        assertFalse(clock.hasAwaiters)
        icon.setState("selected", 0).finish(); runCurrent()
        val shell = icon.paints.filter { !it.part.id.startsWith("calendar-date-") }
        val first = icon.setDate(Instant.parse("2024-03-01T00:30:00Z"), "UTC", 1000)
        first.pause(); first.seek(400f)
        val before = icon.paints.associate { it.part.key to it.alpha.value }
        val reverse = icon.setDate(Instant.parse("2024-02-28T12:00:00Z"), "UTC", 1000)
        assertEquals(before, icon.paints.associate { it.part.key to it.alpha.value })
        assertEquals(MotionResult.Stopped, first.finished.await())
        assertTrue(shell.all { prior -> icon.paints.any { it === prior } })
        assertTrue(icon.paints.all { it.variant == IconVariant.Filled })
        reverse.pause(); reverse.seek(500f); reverse.finish(); runCurrent()
        assertEquals(2, icon.paints.count { it.part.id.startsWith("calendar-date-") })
        val sameDay = icon.setDate(Instant.parse("2024-02-28T19:00:00Z"), "UTC")
        assertEquals(MotionResult.Finished, sameDay.finished.await())
        icon.setState("unselected", 0).finish(); runCurrent()
        assertEquals(2, icon.paints.count { it.part.id.startsWith("calendar-date-") })
        assertTrue(icon.paints.all { it.variant == IconVariant.Outline })
        val removed = icon.setDate(Instant.parse("2024-03-31T12:00:00Z"), "UTC")
        icon.dispose(); runCurrent()
        assertEquals(MotionResult.Stopped, removed.finished.await())
        assertFalse(clock.hasAwaiters)
        assertFailsWith<IllegalStateException> {
            icon.setDate(Instant.parse("2024-03-01T00:00:00Z"), "UTC")
        }
        scope.cancel()
    }
}
