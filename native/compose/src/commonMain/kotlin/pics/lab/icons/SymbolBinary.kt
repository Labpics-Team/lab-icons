package pics.lab.icons

import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/** Compiler entry point for generated Kotlin exports; normal callers import a symbol family. */
@OptIn(ExperimentalEncodingApi::class)
public fun decodeSymbolData(id: String, chunks: Array<String>): SymbolData {
    val reader = SymbolReader(Base64.Default.decode(chunks.joinToString("")))
    require(reader.byte() == 76 && reader.byte() == 73 && reader.byte() == 67 && reader.byte() == 78 && reader.byte() == 1) {
        "Unsupported compiled symbol format"
    }
    fun axis() = IconAxis(reader.float(), reader.float(), reader.float())
    val axes = IconAxes(axis(), axis())
    val variants = Array(2) {
        val paths = Array(reader.count()) {
            val commands = reader.bytes(reader.count())
            require(commands.isNotEmpty())
            val coordinateCount = reader.count()
            var open = false
            val expectedCount = commands.sumOf { command -> when (command.toInt()) {
                0 -> { require(!open); open = true; 2 }
                1 -> { require(open); 2 }
                2 -> { require(open); 6 }
                3 -> { require(open); open = false; 0 }
                else -> error("Unknown path opcode")
            } }
            require(!open) { "Compiled symbol contour is not closed" }
            require(coordinateCount == expectedCount) { "Incompatible symbol path coordinates" }
            val coordinates = FloatArray(coordinateCount) { reader.float() }
            val fillRule = reader.byte(); require(fillRule in 0..1)
            val seenTerms = BooleanArray(8)
            val terms = Array(reader.byte().also { require(it <= 8) }) {
                val term = reader.byte(); require(term in 0..7 && !seenTerms[term]); seenTerms[term] = true
                val count = reader.count(); require(count <= coordinateCount)
                val indices = IntArray(count)
                val values = FloatArray(count)
                for (index in 0 until count) {
                    indices[index] = reader.count()
                    require(indices[index] < coordinateCount && (index == 0 || indices[index] > indices[index - 1]))
                    values[index] = reader.float()
                }
                SymbolDelta(term, indices, values)
            }
            SymbolPathData(commands, coordinates, fillRule == 1, terms)
        }
        val partIds = mutableSetOf<String>()
        val parts = Array(reader.count()) {
            val partId = reader.bytes(reader.count()).decodeToString(throwOnInvalidSequence = true)
            require(partId.isNotBlank() && partIds.add(partId)) { "Compiled symbol part identity is invalid" }
            val pathIndex = reader.count(); require(pathIndex < paths.size)
            val contours = IntArray(reader.count()) { reader.count() }
            val contourCount = paths[pathIndex].commands.count { it == 0.toByte() }
            require(contours.all { it < contourCount } && contours.toSet().size == contours.size)
            SymbolPartData(partId, pathIndex, contours)
        }
        SymbolVariantData(paths, parts)
    }
    require(reader.finished) { "Trailing compiled symbol data" }
    return SymbolData(id, axes, variants)
}

private class SymbolReader(private val source: ByteArray) {
    private var offset = 0
    val finished: Boolean get() = offset == source.size
    fun byte(): Int { require(offset < source.size) { "Truncated compiled symbol" }; return source[offset++].toInt() and 255 }
    private fun bits(): Int = byte() or (byte() shl 8) or (byte() shl 16) or (byte() shl 24)
    fun count(): Int = bits().also { require(it >= 0 && it <= source.size) { "Invalid compiled symbol count" } }
    fun float(): Float = Float.fromBits(bits()).also { require(it.isFinite()) { "Nonfinite symbol coordinate" } }
    fun bytes(count: Int): ByteArray {
        require(count <= source.size - offset) { "Truncated compiled symbol" }
        return source.copyOfRange(offset, offset + count).also { offset += count }
    }
}
