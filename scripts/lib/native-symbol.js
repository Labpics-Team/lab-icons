import { createHash } from 'node:crypto';

const opcodes = { M: 0, L: 1, C: 2, Z: 3 };
const typeName = id => id.replace(/(^|-)([a-z])/g, (_, __, letter) => letter.toUpperCase());
const propertyName = id => { const name = typeName(id); return name[0].toLowerCase() + name.slice(1); };

/** Numeric transport decoded once into Kotlin arrays; no SVG parser is shipped. */
export function encodeNativeSymbol(symbol, anatomy) {
  const chunks = [Buffer.from([76, 73, 67, 78, 5])];
  const byte = value => chunks.push(Buffer.from([value]));
  const count = value => {
    if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new RangeError('native symbol count is out of range');
    const buffer = Buffer.allocUnsafe(4); buffer.writeUInt32LE(value); chunks.push(buffer);
  };
  const scalar = value => {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new RangeError('native symbol requires finite Float coordinates');
    const buffer = Buffer.allocUnsafe(4); buffer.writeFloatLE(value); chunks.push(buffer);
  };
  const text = value => { const buffer = Buffer.from(value, 'utf8'); count(buffer.length); chunks.push(buffer); };
  const opticalScalar = value => {
    scalar(value.base); byte(value.terms.length);
    for (const [term, delta] of value.terms) { byte(term); scalar(delta); }
  };
  const encodePaths = paths => {
    count(paths.length);
    for (const path of paths) {
      count(path.commands.length);
      for (const command of path.commands) {
        if (!Object.hasOwn(opcodes, command)) throw new TypeError(`unsupported native path command: ${command}`);
        byte(opcodes[command]);
      }
      count(path.coordinates.length); path.coordinates.forEach(scalar);
      byte(path.fillRule === 'evenodd' ? 1 : 0);
      byte(path.terms.length);
      for (const [term, delta] of path.terms) {
        byte(term); count(delta.length / 2);
        for (let index = 0; index < delta.length; index += 2) { count(delta[index]); scalar(delta[index + 1]); }
      }
      byte(path.stroke ? 1 : 0); if (path.stroke) opticalScalar(path.stroke.width);
    }
  };
  const encodeParts = (parts, variant) => {
    count(parts.length);
    for (const part of parts) {
      text(part.id); count(part.pathIndex);
      const contours = part.contourIndices ?? [];
      count(contours.length); contours.forEach(count);
      text(part.key ?? `${symbol.id}/${variant}/${part.pathIndex}`);
      (part.anchor ?? [12, 12]).forEach(scalar);
      byte(part.draw ? 1 : 0);
      if (part.draw) {
        const { commands, coordinates } = part.draw.path;
        count(commands.length); for (const command of commands) byte(opcodes[command]);
        count(coordinates.length); coordinates.forEach(scalar); scalar(part.draw.width);
      }
      text(part.layer ?? ''); byte(part.negative ? 1 : 0);
      byte(part.geometry ? 1 : 0);
      if (part.geometry) {
        count(part.geometry.commands.length); for (const command of part.geometry.commands) byte(opcodes[command]);
        part.geometry.basis.forEach(count); count(part.geometry.points.length);
        for (const point of part.geometry.points) {
          byte(typeof point === 'number' ? 0 : 1);
          if (typeof point === 'number') count(point); else point.forEach(scalar);
        }
      }
      byte(part.pivot ? 1 : 0);
      if (part.pivot) { part.pivot.basis.forEach(count); part.pivot.weights.forEach(scalar); }
      byte(part.offsetX ? 1 : 0); if (part.offsetX) opticalScalar(part.offsetX);
    }
  };
  for (const axis of [symbol.data.axes.weight, symbol.data.axes.opsz]) axis.forEach(scalar);
  for (const variant of ['outline', 'filled']) {
    encodePaths(symbol.data.variants[variant].paths);
    const semantic = symbol.semantics?.variants[variant];
    // Keep the v3 slot: v4 readers also accept earlier separate motion paths.
    // New exports reference contours in the sole static numeric path table.
    byte(0);
    const parts = semantic?.parts ?? anatomy.variants[variant].anatomy.parts;
    encodeParts(parts, variant);
    const effects = Object.entries(semantic?.effects ?? {}); count(effects.length);
    for (const [name, effect] of effects) {
      text(name); scalar(effect.duration); scalar(effect.rest); byte(effect.parameter === 'elapsed-hours' ? 1 : 0); count(effect.tracks.length);
      for (const track of effect.tracks) {
        const partIndex = parts.findIndex(part => part.id === track.partId);
        if (partIndex < 0) throw new TypeError(`Native effect references missing part: ${track.partId}`);
        count(partIndex); byte(['opacity','x','y','rotate','draw'].indexOf(track.property)); count(track.stops.length);
        track.stops.forEach(stop => stop.forEach(scalar));
      }
    }
  }
  const states = Object.entries(symbol.semantics?.states ?? {}); count(states.length);
  for (const [name, state] of states) {
    text(name); text(state.id); byte(state.data ? 1 : 0);
    if (state.data) { const bytes = encodeNativeSymbol(state); count(bytes.length); chunks.push(bytes); }
  }
  const calendar = symbol.semantics?.calendar;
  byte(calendar ? 1 : 0);
  if (calendar) {
    text(calendar.key); encodePaths(calendar.digits); opticalScalar(calendar.spacing);
    for (const variant of ['outline', 'filled']) encodeParts(calendar.shells[variant], variant);
  }
  return Buffer.concat(chunks);
}

export function nativeSymbolSource(symbol, anatomy, { packageName = 'pics.lab.icons.symbols', exportId = symbol.id } = {}) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(symbol.id)) throw new TypeError('native symbol requires a safe family identifier');
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(packageName)) throw new TypeError('native export requires a Kotlin package name');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(exportId)) throw new TypeError('native export requires a safe export identifier');
  const bytes = encodeNativeSymbol(symbol, anatomy), name = typeName(exportId);
  const property = propertyName(exportId), base64 = bytes.toString('base64');
  // Keep JVM UTF-8 constants and initializer methods well below their 64 KiB
  // limits, including complex paths such as cog and earth.
  const chunks = base64.match(/.{1,16384}/g);
  const source = `// Generated from SymbolSource. Do not edit.\npackage ${packageName}\n\nimport pics.lab.icons.SymbolData\nimport pics.lab.icons.decodeSymbolData\n\npublic val \`${property}\`: SymbolData get() = ${name}Storage.value\n\nprivate object ${name}Storage {\n    val value = decodeSymbolData("${symbol.id}", arrayOf(\n${chunks.map(chunk => `        "${chunk}"`).join(',\n')}\n    ))\n}\n`;
  return { file: `${name}Symbol.kt`, source, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Cross-language fixtures follow the web sampler, not the native implementation. */
export function nativeSymbolTests(corpus, { opticalPosition, sampleOpticalPath, sampleOpticalScalar }) {
  const calls = [];
  const double = value => Number.isInteger(value) ? `${value}.0` : String(value);
  for (const id of ['plus-circle', 'cog', 'earth', 'star', 'download', 'layers']) {
    const symbol = corpus.symbols[id];
    for (const variant of ['outline', 'filled']) for (const [weight, opsz] of [[300, 48], [350, 20], [400, 24], [500, 36], [600, 16]]) {
      for (const [pathIndex, path] of symbol.data.variants[variant].paths.entries()) {
        const values = sampleOpticalPath(path, opticalPosition(corpus.axes, weight, opsz));
        const count = Math.min(16, values.length);
        const indices = Array.from({ length: count }, (_, index) => Math.round(index * (values.length - 1) / (count - 1)));
        calls.push(`        assertWebSample(\`${propertyName(id)}\`, IconVariant.${variant === 'outline' ? 'Outline' : 'Filled'}, ${weight}f, ${opsz}f, ${pathIndex},\n            intArrayOf(${indices.join(',')}), doubleArrayOf(${indices.map(index => double(values[index])).join(',')}))`);
      }
    }
  }
  const calendarCalls = [];
  const calendar = corpus.symbols['calendar-number'].semantics.calendar;
  const calendarPositions = [300, 400, 600].flatMap(weight => [16, 24, 48].map(opsz => [weight, opsz])).concat([[350, 20], [450, 32]]);
  for (const [weight, opsz] of calendarPositions) for (const [digit, path] of calendar.digits.entries()) {
    const at = opticalPosition(corpus.axes, weight, opsz), values = sampleOpticalPath(path, at);
    const indices = Array.from({ length: Math.min(8, values.length) }, (_, i) => Math.floor(i * (values.length - 1) / (Math.min(8, values.length) - 1)));
    calendarCalls.push(`        assertCalendarSample(calendarNumber, ${weight}f, ${opsz}f, ${digit}, ${double(sampleOpticalScalar(calendar.spacing, at))}, ${double(sampleOpticalScalar(path.stroke.width, at))}, intArrayOf(${indices.join(',')}), doubleArrayOf(${indices.map(i => double(values[i])).join(',')}))`);
  }
  return `// Generated independently from the web optical sampler. Do not edit.\npackage pics.lab.icons\n\nimport pics.lab.icons.symbols.*\nimport kotlin.math.abs\nimport kotlin.test.*\n\nclass NativeCorpusTest {\n    @Test fun wholeCorpusDecodesAndPreservesCenter() {\n        val corpus = listOf(${Object.keys(corpus.symbols).map(id => `\`${propertyName(id)}\``).join(',')})\n        assertEquals(${Object.keys(corpus.symbols).length}, corpus.size)\n        for (symbol in corpus) for (variant in symbol.variants) for (path in variant.paths) {\n            val buffer = FloatArray(path.coordinates.size)\n            path.sample(1, 1f, 0, 1f, buffer)\n            path.sample(1, 0f, 1, 0f, buffer)\n            assertContentEquals(path.coordinates, buffer, symbol.id)\n        }\n        assertSame(cog, cog)\n    }\n\n    @Test fun floatSamplingMatchesWebGeometry() {\n${calls.join('\n')}\n    }\n\n    @Test fun calendarCoordinatesStrokeAndSpacingMatchWeb() {\n${calendarCalls.join('\n')}\n    }\n}\n\nprivate fun assertWebSample(symbol: SymbolData, variant: IconVariant, weight: Float, opsz: Float, pathIndex: Int, indices: IntArray, expected: DoubleArray) {\n    val path = symbol.variants[variant.ordinal].paths[pathIndex]\n    val target = FloatArray(path.coordinates.size)\n    val weightAxis = symbol.axes.weight\n    val opticalAxis = symbol.axes.opsz\n    path.sample(if (weight < weightAxis.default) 0 else 1, weightAxis.position(weight), if (opsz < opticalAxis.default) 0 else 1, opticalAxis.position(opsz), target)\n    for (index in indices.indices) {\n        // At 48 logical units this is less than one 1/1024-pixel coordinate step.\n        assertTrue(abs(target[indices[index]].toDouble() - expected[index]) < 1.0 / 2048.0, "Web/native geometry differs: \${symbol.id}/$variant/$weight/$opsz/$pathIndex/\${indices[index]}")\n    }\n}\n\nprivate fun assertCalendarSample(symbol: SymbolData, weight: Float, optical: Float, digit: Int, spacing: Double, width: Double, indices: IntArray, values: DoubleArray) {\n    val calendar = symbol.calendar!!\n    val path = calendar.digits[digit]\n    val ws = if (weight < symbol.axes.weight.default) 0 else 1\n    val os = if (optical < symbol.axes.opsz.default) 0 else 1\n    val wp = symbol.axes.weight.position(weight)\n    val op = symbol.axes.opsz.position(optical)\n    assertEquals(spacing, calendar.spacing.sample(ws, wp, os, op).toDouble(), 0.00001)\n    assertEquals(width, path.strokeWidth!!.sample(ws, wp, os, op).toDouble(), 0.00001)\n    val target = FloatArray(path.coordinates.size)\n    path.sample(ws, wp, os, op, target)\n    for (i in indices.indices) assertEquals(values[i], target[indices[i]].toDouble(), 1.0 / 2048.0)\n}\n`;
}
