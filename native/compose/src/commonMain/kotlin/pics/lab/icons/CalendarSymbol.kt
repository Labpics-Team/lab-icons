package pics.lab.icons

import kotlin.time.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

/** The caller owns the instant. No clock, observer, locale-dependent parser or refresh job. */
internal fun calendarDay(date: Instant, timeZone: String): Int {
    require(timeZone in TimeZone.availableZoneIds) { "Calendar timeZone must be a named IANA zone" }
    return date.toLocalDateTime(TimeZone.of(timeZone)).day
}

internal fun resolveCalendarRequest(symbol: SymbolData, date: Instant?, timeZone: String?): Int? {
    require((date == null) == (timeZone == null)) { "Calendar date and timeZone must be supplied together" }
    if (date == null) return null
    require(symbol.calendar != null) { "Symbol ${symbol.id} does not support a calendar date" }
    return calendarDay(date, timeZone!!)
}

/** Select shared glyph data and optical spacing; authored shell geometry remains the same object. */
internal fun resolveCalendarSymbol(symbol: SymbolData, day: Int?): SymbolData {
    if (day == null) return symbol
    require(day in 1..31)
    val calendar = requireNotNull(symbol.calendar) { "Symbol ${symbol.id} does not support a calendar date" }
    val values = if (day < 10) intArrayOf(day) else intArrayOf(day / 10, day % 10)
    val variants = Array(2) { variant ->
        val source = symbol.variants[variant]
        val shells = calendar.shells[variant]
        val layer = requireNotNull(shells.first().layer)
        val digits = Array(values.size) { index ->
            val slot = if (index == 0 && values.size == 2) "tens" else "ones"
            val side = if (values.size == 1) 0 else if (index == 0) -1 else 1
            val digit = values[index]
            SymbolPartData("calendar-date-$slot", source.paths.size + digit, IntArray(0),
                "$layer/${calendar.key}/$slot/$digit/$side", layer = layer,
                negative = variant == IconVariant.Filled.ordinal, offsetX = calendar.spacing.times(side.toFloat()))
        }
        SymbolVariantData(source.paths + calendar.digits, shells + digits)
    }
    return SymbolData(symbol.id, symbol.axes, variants, symbol.states, calendar)
}
