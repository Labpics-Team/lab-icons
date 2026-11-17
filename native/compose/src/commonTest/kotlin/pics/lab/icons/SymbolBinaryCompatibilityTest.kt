package pics.lab.icons

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertFailsWith

class SymbolBinaryCompatibilityTest {
    @Test fun versionFiveAdmitsOpenStrokeAndRejectsOpenFill() {
        val stroke = "TElDTgUAAJZDAADIQwAAFkQAAIBBAADAQQAAQEIBAAAAAgAAAAABBAAAAAAAgEAAAIBAAACgQQAAoEEAAAEAAABAAgAAAAC/AQAAgD8AAQAAAAQAAABsaW5lAAAAAAAAAAAEAAAAbGluZQAAQEEAAEBBAAAAAAAAAAAAAAAAAAEAAAACAAAAAAEEAAAAAACAQAAAgEAAAKBBAACgQQAAAQAAAEACAAAAAL8BAACAPwABAAAABAAAAGxpbmUAAAAAAAAAAAQAAABsaW5lAABAQQAAQEEAAAAAAAAAAAAAAAAAAAAAAAA="
        val fill = "TElDTgUAAJZDAADIQwAAFkQAAIBBAADAQQAAQEIBAAAAAgAAAAABBAAAAAAAgEAAAIBAAACgQQAAoEEAAAAAAQAAAAQAAABsaW5lAAAAAAAAAAAEAAAAbGluZQAAQEEAAEBBAAAAAAAAAAAAAAAAAAEAAAACAAAAAAEEAAAAAACAQAAAgEAAAKBBAACgQQAAAAABAAAABAAAAGxpbmUAAAAAAAAAAAQAAABsaW5lAABAQQAAQEEAAAAAAAAAAAAAAAAAAAAAAAA="
        val symbol = decodeSymbolData("open-line", arrayOf(stroke))
        assertEquals(1.5f, symbol.variants[0].paths.single().strokeWidth!!.sample(0, 1f, 0, 1f))
        assertEquals(3f, symbol.variants[0].paths.single().strokeWidth!!.sample(1, 1f, 1, 1f))
        assertFailsWith<IllegalArgumentException> { decodeSymbolData("open-line", arrayOf(fill)) }
    }

    // Actual compiler output retained across the version 5 scalar/calendar extension.
    private val previous = arrayOf(
        // 4dee2c0 / format 1
        "TElDTgEAAJZDAADIQwAAFkQAAIBBAADAQQAAQEIBAAAABQAAAAABAQEDCAAAAAAAgEAAAIBAAACgQQAAgEAAAKBBAACgQQAAgEAAAKBBAAABAAAABgAAAHNxdWFyZQAAAAAAAAAAAQAAAAUAAAAAAQEBAwgAAAAAAIBAAACAQAAAoEEAAIBAAACgQQAAoEEAAIBAAACgQQAAAQAAAAYAAABzcXVhcmUAAAAAAAAAAA==",
        // c91dc75 / format 2
        "TElDTgIAAJZDAADIQwAAFkQAAIBBAADAQQAAQEIBAAAABQAAAAABAQEDCAAAAAAAgEAAAIBAAACgQQAAgEAAAKBBAACgQQAAgEAAAKBBAAABAAAABgAAAHNxdWFyZQAAAAAAAAAAFwAAAGxlZ2FjeS1zcXVhcmUvb3V0bGluZS8wAABAQQAAQEEAAAAAAAEAAAAFAAAAAAEBAQMIAAAAAACAQAAAgEAAAKBBAACAQAAAoEEAAKBBAACAQAAAoEEAAAEAAAAGAAAAc3F1YXJlAAAAAAAAAAAWAAAAbGVnYWN5LXNxdWFyZS9maWxsZWQvMAAAQEEAAEBBAAAAAAAAAAAA",
        // 14cd6ef / format 3
        "TElDTgMAAJZDAADIQwAAFkQAAIBBAADAQQAAQEIBAAAABQAAAAABAQEDCAAAAAAAgEAAAIBAAACgQQAAgEAAAKBBAACgQQAAgEAAAKBBAAAAAQAAAAYAAABzcXVhcmUAAAAAAAAAAAYAAABzcXVhcmUAAEBBAABAQQAAAAAAAAAAAAABAAAABQAAAAABAQEDCAAAAAAAgEAAAIBAAACgQQAAgEAAAKBBAACgQQAAgEAAAKBBAAAAAQAAAAYAAABzcXVhcmUAAAAAAAAAAAYAAABzcXVhcmUAAEBBAABAQQAAAAAAAAAAAAAAAAAA",
        // 7063442 / format 4
        "TElDTgQAAJZDAADIQwAAFkQAAIBBAADAQQAAQEIBAAAABQAAAAABAQEDCAAAAAAAgEAAAIBAAACgQQAAgEAAAKBBAACgQQAAgEAAAKBBAAAAAQAAAAYAAABzcXVhcmUAAAAAAAAAAAYAAABzcXVhcmUAAEBBAABAQQAAAAAAAAAAAAAAAAEAAAAFAAAAAAEBAQMIAAAAAACAQAAAgEAAAKBBAACAQAAAoEEAAKBBAACAQAAAoEEAAAABAAAABgAAAHNxdWFyZQAAAAAAAAAABgAAAHNxdWFyZQAAQEEAAEBBAAAAAAAAAAAAAAAAAAAAAA=="
    )
    @Test fun oldExportsKeepTheirGeometryAndDefaultPaintSemantics() {
        for (data in previous) {
            val symbol = decodeSymbolData("legacy-square", arrayOf(data))
            assertEquals(400f, symbol.axes.weight.default)
            assertNull(symbol.calendar)
            for (variant in symbol.variants) {
                assertNull(variant.motionPaths)
                assertEquals(8, variant.paths.single().coordinates.size)
                assertEquals("square", variant.parts.single().id)
                assertNull(variant.parts.single().layer)
                assertFalse(variant.parts.single().negative)
                assertNull(variant.parts.single().offsetX)
                assertNull(variant.paths.single().strokeWidth)
            }
        }
    }
}
