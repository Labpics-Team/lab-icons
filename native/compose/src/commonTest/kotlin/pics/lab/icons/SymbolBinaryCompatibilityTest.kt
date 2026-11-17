package pics.lab.icons

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class SymbolBinaryCompatibilityTest {
    // Actual output of the version 1 and 2 compilers, retained across the version 3 extension.
    private val previous = arrayOf(
        // 4dee2c0 / format 1
        "TElDTgEAAJZDAADIQwAAFkQAAIBBAADAQQAAQEIBAAAABQAAAAABAQEDCAAAAAAAgEAAAIBAAACgQQAAgEAAAKBBAACgQQAAgEAAAKBBAAABAAAABgAAAHNxdWFyZQAAAAAAAAAAAQAAAAUAAAAAAQEBAwgAAAAAAIBAAACAQAAAoEEAAIBAAACgQQAAoEEAAIBAAACgQQAAAQAAAAYAAABzcXVhcmUAAAAAAAAAAA==",
        // c91dc75 / format 2
        "TElDTgIAAJZDAADIQwAAFkQAAIBBAADAQQAAQEIBAAAABQAAAAABAQEDCAAAAAAAgEAAAIBAAACgQQAAgEAAAKBBAACgQQAAgEAAAKBBAAABAAAABgAAAHNxdWFyZQAAAAAAAAAAFwAAAGxlZ2FjeS1zcXVhcmUvb3V0bGluZS8wAABAQQAAQEEAAAAAAAEAAAAFAAAAAAEBAQMIAAAAAACAQAAAgEAAAKBBAACAQAAAoEEAAKBBAACAQAAAoEEAAAEAAAAGAAAAc3F1YXJlAAAAAAAAAAAWAAAAbGVnYWN5LXNxdWFyZS9maWxsZWQvMAAAQEEAAEBBAAAAAAAAAAAA"
    )
    @Test fun oldExportsKeepTheirGeometryAndDefaultPaintSemantics() {
        for (data in previous) {
            val symbol = decodeSymbolData("legacy-square", arrayOf(data))
            assertEquals(400f, symbol.axes.weight.default)
            for (variant in symbol.variants) {
                assertNull(variant.motionPaths)
                assertEquals(8, variant.paths.single().coordinates.size)
                assertEquals("square", variant.parts.single().id)
                assertNull(variant.parts.single().layer)
                assertFalse(variant.parts.single().negative)
            }
        }
    }
}
