package pics.lab.icons

import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/** Compiler entry point for generated Kotlin exports; normal callers import a symbol family. */
@OptIn(ExperimentalEncodingApi::class)
public fun decodeSymbolData(id: String, chunks: Array<String>): SymbolData {
    return decodeSymbolBytes(id, Base64.Default.decode(chunks.joinToString("")))
}

private fun decodeSymbolBytes(id: String, bytes: ByteArray, depth: Int = 0): SymbolData {
    require(depth <= 1) { "Nested symbol state groups are not supported" }
    val reader = SymbolReader(bytes)
    require(reader.byte() == 76 && reader.byte() == 73 && reader.byte() == 67 && reader.byte() == 78) {
        "Unsupported compiled symbol format"
    }
    val version = reader.byte(); require(version in 1..5)
    fun axis() = IconAxis(reader.float(), reader.float(), reader.float())
    val axes = IconAxes(axis(), axis())
    fun readOpticalScalar(positive: Boolean = false): OpticalScalar {
        val base = reader.float()
        val count = reader.byte(); require(count <= 8)
        val seen = BooleanArray(8)
        val terms = IntArray(count)
        val deltas = FloatArray(count)
        for (index in 0 until count) {
            val term = reader.byte(); require(term in 0..7 && !seen[term])
            seen[term] = true; terms[index] = term; deltas[index] = reader.float()
        }
        val result = OpticalScalar(base, terms, deltas)
        for (weightSide in 0..1) for (opticalSide in 0..1) for (weight in 0..1) for (optical in 0..1) {
            val value = result.sample(weightSide, weight.toFloat(), opticalSide, optical.toFloat())
            require(value.isFinite() && (!positive || value > 0f)) { "Invalid optical scalar support" }
        }
        return result
    }
    fun readPaths(): Array<SymbolPathData> = Array(reader.count()) {
        val commands = reader.bytes(reader.count())
        val coordinateCount = reader.count()
        val expectedCount = pathCoordinateCount(commands, allowOpen = version >= 5)
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
        val stroke = if (version < 5) null else when (reader.byte()) {
            0 -> null
            1 -> readOpticalScalar(positive = true)
            else -> error("Invalid stroke flag")
        }
        if (stroke == null && version >= 5) pathCoordinateCount(commands, allowOpen = false)
        SymbolPathData(commands, coordinates, fillRule == 1, terms, stroke)
    }
    fun readParts(partPaths: Array<SymbolPathData>): Array<SymbolPartData> {
        val partIds = mutableSetOf<String>()
        return Array(reader.count()) {
            val partId = reader.bytes(reader.count()).decodeToString(throwOnInvalidSequence = true)
            require(partId.isNotBlank() && partIds.add(partId)) { "Compiled symbol part identity is invalid" }
            val pathIndex = reader.count(); require(pathIndex < partPaths.size)
            val contours = IntArray(reader.count()) { reader.count() }
            val contourCount = partPaths[pathIndex].commands.count { it == 0.toByte() }
            require(contours.all { it < contourCount } && contours.toSet().size == contours.size)
            if (version == 1) SymbolPartData(partId, pathIndex, contours) else {
                val key = reader.text(); val x = reader.float(); val y = reader.float()
                val draw = when (reader.byte()) {
                    0 -> null
                    1 -> {
                        val commands = reader.bytes(reader.count())
                        val coordinates = FloatArray(reader.count()) { reader.float() }
                        require(commands.isNotEmpty() && commands[0] == 0.toByte())
                        require(commands.sumOf { when (it.toInt()) { 0, 1 -> 2; 2 -> 6; else -> error("Invalid draw guide opcode") } } == coordinates.size)
                        val width = reader.float(); require(width > 0)
                        SymbolDrawData(commands, coordinates, width)
                    }
                    else -> error("Invalid draw guide flag")
                }
                val layer = if (version < 3) null else reader.text().ifEmpty { null }
                val negative = if (version < 3) false else when (reader.byte()) {
                    0 -> false
                    1 -> true
                    else -> error("Invalid subtractive part flag")
                }
                require(!negative || layer != null) { "Subtractive parts require an isolated layer" }
                val pointCount = partPaths[pathIndex].coordinates.size / 2
                fun basis() = IntArray(3) { reader.count().also { require(it < pointCount) } }
                fun weights() = FloatArray(3) { reader.float().also { require(it in 0f..1f) } }.also {
                    require(kotlin.math.abs(it.sum() - 1f) <= .000001f)
                }
                val geometry = if (version < 4) null else when (reader.byte()) {
                    0 -> null
                    1 -> {
                        val commands = reader.bytes(reader.count())
                        val coordinateCount = pathCoordinateCount(commands, allowOpen = partPaths[pathIndex].strokeWidth != null)
                        val basis = basis()
                        val points = Array(reader.count()) { when (reader.byte()) {
                            0 -> SymbolPointReference(reader.count().also { require(it < pointCount) }, null)
                            1 -> SymbolPointReference(-1, weights())
                            else -> error("Invalid source point reference")
                        } }
                        require(coordinateCount == points.size * 2) { "Incompatible symbol path references" }
                        SymbolPathViewData(commands, basis, points)
                    }
                    else -> error("Invalid path view flag")
                }
                val pivot = if (version < 4) null else when (reader.byte()) {
                    0 -> null
                    1 -> SymbolPointProjection(basis(), weights())
                    else -> error("Invalid pivot flag")
                }
                val offsetX = if (version < 5) null else when (reader.byte()) {
                    0 -> null
                    1 -> readOpticalScalar()
                    else -> error("Invalid optical offset flag")
                }
                SymbolPartData(partId, pathIndex, contours, key, x, y, draw, layer, negative, geometry, pivot, offsetX)
            }
        }
    }
    val variants = Array(2) {
        val paths = readPaths()
        val motionPaths = if (version < 3) null else when (reader.byte()) {
            0 -> null
            1 -> readPaths()
            else -> error("Invalid motion paths flag")
        }
        val parts = readParts(motionPaths ?: paths)
        val effects = if (version == 1) emptyMap() else buildMap {
            repeat(reader.count()) {
                val name = reader.text(); require(name.isNotBlank() && !containsKey(name))
                val durationValue = reader.float(); require(durationValue >= 0 && durationValue < Int.MAX_VALUE && durationValue % 1f == 0f)
                val duration = durationValue.toInt(); val rest = reader.float(); require(rest in 0f..1f)
                val elapsedHours = if (version < 4) false else when (reader.byte()) { 0 -> false; 1 -> true; else -> error("Invalid effect parameter") }
                val tracks = Array(reader.count()) {
                    val part = reader.count(); require(part < parts.size)
                    val property = reader.byte(); require(property in 0..4)
                    val count = reader.count(); require(count >= 2)
                    val times = FloatArray(count); val values = FloatArray(count)
                    for (index in 0 until count) {
                        times[index] = reader.float(); values[index] = reader.float()
                        require(times[index] in 0f..1f && (index == 0 || times[index] > times[index - 1]))
                    }
                    require(times.first() == 0f && times.last() == 1f)
                    SymbolTrackData(part, property, times, values)
                }
                put(name, SymbolEffectData(duration, rest, tracks, elapsedHours))
            }
        }
        SymbolVariantData(paths, parts, effects, motionPaths)
    }
    val states = if (version == 1) emptyMap() else buildMap {
        repeat(reader.count()) {
            val name = reader.text(); val target = reader.text(); require(name.isNotBlank() && !containsKey(name))
            val state = when (reader.byte()) {
                0 -> { require(target == id); null }
                1 -> decodeSymbolBytes(target, reader.bytes(reader.count()), depth + 1)
                else -> error("Invalid symbol state flag")
            }
            put(name, state)
        }
    }
    val calendar = if (version < 5) null else when (reader.byte()) {
        0 -> null
        1 -> {
            val key = reader.text(); require(key.isNotBlank())
            val digits = readPaths(); require(digits.size == 10) { "A calendar requires ten shared digits" }
            val spacing = readOpticalScalar(positive = true)
            val shells = Array(2) { variant ->
                readParts(variants[variant].paths).also { parts ->
                    require(parts.isNotEmpty() && parts.first().layer != null) { "Calendar shell requires an isolated layer" }
                }
            }
            CalendarSymbolData(key, digits, spacing, shells)
        }
        else -> error("Invalid calendar flag")
    }
    require(reader.finished) { "Trailing compiled symbol data" }
    return SymbolData(id, axes, variants, states, calendar)
}

private fun pathCoordinateCount(commands: ByteArray, allowOpen: Boolean): Int {
    require(commands.isNotEmpty())
    var open = false
    val count = commands.sumOf { command -> when (command.toInt()) {
        0 -> { require(allowOpen || !open); open = true; 2 }
        1 -> { require(open); 2 }
        2 -> { require(open); 6 }
        3 -> { require(open); open = false; 0 }
        else -> error("Unknown path opcode")
    } }
    require(allowOpen || !open) { "Compiled symbol contour is not closed" }
    return count
}

private class SymbolReader(private val source: ByteArray) {
    private var offset = 0
    val finished: Boolean get() = offset == source.size
    fun byte(): Int { require(offset < source.size) { "Truncated compiled symbol" }; return source[offset++].toInt() and 255 }
    private fun bits(): Int = byte() or (byte() shl 8) or (byte() shl 16) or (byte() shl 24)
    fun count(): Int = bits().also { require(it >= 0 && it <= source.size) { "Invalid compiled symbol count" } }
    fun float(): Float = Float.fromBits(bits()).also { require(it.isFinite()) { "Nonfinite symbol coordinate" } }
    fun text(): String = bytes(count()).decodeToString(throwOnInvalidSequence = true)
    fun bytes(count: Int): ByteArray {
        require(count <= source.size - offset) { "Truncated compiled symbol" }
        return source.copyOfRange(offset, offset + count).also { offset += count }
    }
}
