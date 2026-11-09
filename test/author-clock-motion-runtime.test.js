import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { loadAuthorBaseline } from "../scripts/lib/author-baseline.js";
import { compileAuthorClockJoint } from "../scripts/lib/author-clock-joint.js";
import { createCompiledClockPreparation, createCompiledClockCapabilities } from "../src/ir/author-clock-motion-runtime.js";
const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../semantics/figma-baseline.json", import.meta.url), "utf8"));
const baseline = loadAuthorBaseline(root, { manifest: {
  ...manifest,
  counts: { families: 2, variants: 4 },
  icons: { time: manifest.icons.time, history: manifest.icons.history }
} });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stableJSON = (value) => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
function signed(program) {
  return { ...program, packetSha256: hash(stableJSON(program)) };
}
const examples = [
  { icon: "time", variant: "outline", pathIndex: 0, contourIndex: 0, polarity: "positive" },
  { icon: "time", variant: "filled", pathIndex: 0, contourIndex: 1, polarity: "negative" },
  { icon: "history", variant: "outline", pathIndex: 1, contourIndex: 0, polarity: "positive" },
  { icon: "history", variant: "filled", pathIndex: 1, contourIndex: 0, polarity: "positive" }
];
const fixtures = examples.map((example) => {
  const source = baseline.icons[example.icon][example.variant];
  const joint = compileAuthorClockJoint(source, {
    pathIndex: example.pathIndex,
    contourIndex: example.contourIndex,
    polarity: example.polarity,
    partIds: { minute: "clock-minute", hour: "clock-hour" }
  });
  let pathIndex = 0;
  const svg = source.artifactSvg.replace(/<path\b/g, () => `<path data-part="${pathIndex++ === example.pathIndex ? "clock-hands" : "clock-enclosure"}"`);
  const viewBox = /\bviewBox="([^"]+)"/.exec(source.artifactSvg)[1].split(/\s+/).map(Number);
  const packet = signed({
    version: 1,
    law: "joint.authored-elbow",
    icon: example.icon,
    variant: example.variant,
    polarity: example.polarity,
    coordinateSpace: "viewBox",
    bearing: joint.bearing,
    viewBox,
    svg,
    originalD: joint.original.d,
    limbs: joint.limbs.map((limb, index) => ({ ...limb, turnsPerHour: index === 0 ? 1 : 1 / 12 })),
    renderTarget: {
      selector: '[data-part="clock-hands"]',
      attribute: "d",
      partIds: joint.limbs.map((limb) => limb.id),
      unchangedPartIds: example.polarity === "positive" ? ["clock-enclosure"] : []
    }
  });
  return { ...example, source, packet };
});
const positive = fixtures.filter((fixture) => fixture.polarity === "positive");
const first = positive[0].packet;
function prepare(packet, factory = createCompiledClockPreparation) {
  const result = factory({ [packet.variant]: packet })(packet.variant);
  if (!result.ok) throw new Error(`Допустимый positive target отказан: ${result.reason.code}`);
  return result.prepared;
}
// Decoder читает числовой результат; oracle использует authored operands
// и ортогональные перестановки, не повторяя runtime-тригонометрию.
const NUMBER = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
function sampledPoints(prepared, hours) {
  const result = prepared.sample(hours);
  if (!result.ok) throw new Error(`Конечный elapsedHours отказан: ${result.reason.code}`);
  const contours = result.d.match(/M[^M]*Z/g) ?? [];
  expect(contours).toHaveLength(2);
  return contours.map((contour) => {
    const values = [...contour.matchAll(NUMBER)].map((match) => Number(match[0]));
    expect(values.length % 2).toBe(0);
    expect(values.every(Number.isFinite)).toBe(true);
    return Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]]);
  });
}
function near(actual, expected) {
  // Gamma(24) покрывает цепочку binary64 операций и округлённый quarter turn.
  // Это контроль units/rates, не оптический допуск или непрерывный proof.
  const u = Number.EPSILON / 2, gamma = 24 * u / (1 - 24 * u);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(gamma * Math.max(1, Math.abs(actual), Math.abs(expected)));
}
function orthogonal(point, bearing, quarter) {
  const x = point[0] - bearing[0], y = point[1] - bearing[1];
  switch ((quarter % 4 + 4) % 4) {
    case 0:
      return point;
    case 1:
      return [bearing[0] - y, bearing[1] + x];
    case 2:
      return [bearing[0] - x, bearing[1] - y];
    default:
      return [bearing[0] + y, bearing[1] - x];
  }
}
function assertOrthogonal(prepared, packet) {
  for (const quarter of [-3, -2, -1, 1, 2, 3]) {
    for (const [hours, limbIndex] of [[quarter / 4, 0], [quarter * 3, 1]]) {
      const points = sampledPoints(prepared, hours)[limbIndex];
      const limb = packet.limbs[limbIndex];
      expect(points).toHaveLength(limb.points.length);
      points.forEach((point, index) => {
        const expected = orthogonal(limb.points[index], packet.bearing, quarter);
        near(point[0], expected[0]);
        near(point[1], expected[1]);
      });
    }
  }
}
describe("подготовленные authored стрелки: реальный compiler → runtime", () => {
  it.each(positive)("$icon/$variant сохраняет точный rest, SVG и warm prepared identity", ({ packet }) => {
    const factory = createCompiledClockPreparation({ [packet.variant]: packet });
    const a = factory(packet.variant), b = factory(packet.variant);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("Допустимый prepared target не достигнут");
    expect(a.prepared).toBe(b.prepared);
    expect(a.prepared.svg).toBe(packet.svg);
    expect(a.prepared.renderTarget).toEqual(packet.renderTarget);
    expect(Object.isFrozen(a.prepared)).toBe(true);
    expect(Object.isFrozen(a.prepared.renderTarget.partIds)).toBe(true);
    for (const hours of [-24, -12, -0, 0, 12, 24]) {
      const result = a.prepared.sample(hours);
      expect(result).toEqual({ ok: true, elapsedHours: hours, d: packet.originalD });
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
  it.each(positive)("$icon/$variant: independent quarter turns используют authored bearing и разные rates", ({ packet }) => {
    assertOrthogonal(prepare(packet), packet);
  });
  it.each(positive)("$icon/$variant: reverse и новый sample не меняют радиусы или прежний результат", ({ packet }) => {
    const prepared = prepare(packet), saved = prepared.sample(0.375);
    const snapshot = stableJSON(saved), [cx, cy] = packet.bearing;
    for (const hours of [-3.875, -1.25, -0.125, 0.125, 0.375, 1.25, 3.875]) {
      const contours = sampledPoints(prepared, hours);
      contours.forEach((points, limbIndex) => points.forEach((point, index) => {
        const original = packet.limbs[limbIndex].points[index];
        near(Math.hypot(point[0] - cx, point[1] - cy), Math.hypot(original[0] - cx, original[1] - cy));
      }));
    }
    expect(stableJSON(saved)).toBe(snapshot);
    expect(prepared.sample(0.375)).toEqual(saved);
    expect(prepared.svg).toBe(packet.svg);
  });
  it("граница rest непрерывна с двух сторон; extreme finite hours остаются конечными", () => {
    const prepared = prepare(first), delta = 1 / 1024;
    const before = sampledPoints(prepared, -delta), after = sampledPoints(prepared, delta);
    first.limbs.forEach((limb, limbIndex) => limb.points.forEach((point, index) => {
      const radius = Math.hypot(point[0] - first.bearing[0], point[1] - first.bearing[1]);
      const a = before[limbIndex][index], b = after[limbIndex][index];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThanOrEqual(radius * 4 * Math.PI * delta + Number.EPSILON * 24);
    }));
    for (const hours of [Number.MAX_VALUE, -Number.MAX_VALUE, 1e300, -Number.MAX_SAFE_INTEGER]) {
      const sample = prepared.sample(hours);
      expect(sample.ok).toBe(true);
      if (sample.ok) expect(sample.d).not.toMatch(/NaN|Infinity/);
    }
  });
  it("Filled time отказывает вычитанию двух пересекающихся holes, positive сосед остаётся достижим", () => {
    const negative = fixtures.find((fixture) => fixture.polarity === "negative").packet;
    const factory = createCompiledClockPreparation({ outline: first, filled: negative });
    expect(factory("filled")).toMatchObject({ ok: false, reason: { code: "COMPOSITION_UNSUPPORTED" } });
    expect(factory("outline").ok).toBe(true);
    expect(Object.isFrozen(factory("filled"))).toBe(true);
  });
  it.each([void 0, null, NaN, Infinity, -Infinity, "1", {}, []])("elapsedHours %j даёт точный INVALID_REQUEST", (input) => {
    const result = prepare(first).sample(input);
    expect(result).toMatchObject({ ok: false, reason: { code: "INVALID_REQUEST" } });
  });
  it("default/variant selection отличает отсутствующий target от невалидного запроса", () => {
    const factory = createCompiledClockPreparation({ outline: first });
    expect(factory().ok).toBe(true);
    expect(factory("filled")).toMatchObject({ ok: false, reason: { code: "VARIANT_UNSUPPORTED" } });
    for (const value of [null, 1, "duotone", {}]) expect(factory(value)).toMatchObject({ ok: false, reason: { code: "INVALID_REQUEST" } });
  });
  it("target refusal сохраняет точную immutable причину без геометрического packet", () => {
    const refusal = { ok: false, reason: { code: "COMPOSITION_UNSUPPORTED", message: "Нет union-minus target." } };
    const factory = createCompiledClockPreparation({ outline: first, filled: refusal });
    expect(factory("filled")).toBe(refusal);
    expect(Object.isFrozen(refusal.reason)).toBe(true);
    expect(factory().ok).toBe(true);
    expect(() => createCompiledClockPreparation({ filled: { ok: false, reason: { code: "UNKNOWN", message: "" } } })).toThrow(TypeError);
  });
  it("stale digest связывает bearing, polarity, SVG и physical target", () => {
    for (const mutate of [
      (packet) => {
        packet.bearing[0] += 1;
      },
      (packet) => {
        packet.polarity = "negative";
      },
      (packet) => {
        packet.svg += " ";
      },
      (packet) => {
        packet.renderTarget.selector = '[data-part="another"]';
      }
    ]) {
      const packet = structuredClone(first);
      mutate(packet);
      expect(() => createCompiledClockPreparation({ outline: packet })).toThrow(TypeError);
    }
    expect(prepare(first).sample(0.25).ok).toBe(true);
  });
  it("пересчитанный digest не разрешает сломанную grammar, единицы, rates или part mapping", () => {
    for (const mutate of [
      (packet) => {
        packet.variant = "filled";
      },
      (packet) => {
        packet.coordinateSpace = "normalized";
      },
      (packet) => {
        packet.viewBox[2] = 0;
      },
      (packet) => {
        packet.limbs[0].commands = "MMZ";
      },
      (packet) => {
        packet.limbs[0].points.pop();
      },
      (packet) => {
        packet.limbs[0].points[0][0] = NaN;
      },
      (packet) => {
        packet.limbs[1].id = packet.limbs[0].id;
      },
      (packet) => {
        packet.limbs[1].turnsPerHour = 1;
      },
      (packet) => {
        packet.renderTarget.partIds.reverse();
      }
    ]) {
      const packet = structuredClone(first);
      mutate(packet);
      const { packetSha256: _oldDigest, ...program } = packet;
      expect(() => createCompiledClockPreparation({ outline: signed(program) })).toThrow(TypeError);
    }
  });
  it("metadata сохраняет author identity и точный negative refusal независимо от sampler", () => {
    const source = positive[0].source;
    const capability = {
      version: 1,
      icon: first.icon,
      variant: first.variant,
      law: first.law,
      parameter: "elapsed-hours",
      reference: "authored-pose",
      formats: ["svg", "prepared-clock-hands"],
      author: source.author,
      geometrySha256: first.packetSha256
    };
    const refusal = { ok: false, reason: { code: "COMPOSITION_UNSUPPORTED", message: "Нет union-minus target." } };
    const factory = createCompiledClockCapabilities({ outline: capability, filled: refusal });
    const a = factory(), b = factory("outline");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("Допустимый metadata target не достигнут");
    expect(a.capabilities).toBe(b.capabilities);
    expect(a.capabilities.author).toEqual(source.author);
    expect(Object.isFrozen(a.capabilities.author)).toBe(true);
    expect(factory("filled")).toEqual(refusal);
    expect(factory(null)).toMatchObject({ ok: false, reason: { code: "INVALID_REQUEST" } });
  });
  it("ортогональный oracle обнаруживает canvas pivot и общий rate: два исполнимых mutant controls", async () => {
    const runtime = new URL("../src/ir/author-clock-motion-runtime.ts", import.meta.url);
    const original = readFileSync(runtime, "utf8");
    const mutations = [
      ["const [cx, cy] = packet.bearing;", "const [cx, cy] = [12, 12];"],
      ["limb.turnsPerHour === 1 ? hours % 1 : hours / 12", "hours / 12"]
    ];
    const history = positive.find((fixture) => fixture.icon === "history").packet;
    assertOrthogonal(prepare(history), history);
    for (const [before, after] of mutations) {
      expect(original).toContain(before);
      const result = await build({
        stdin: {
          contents: original.replace(before, after),
          resolveDir: dirname(fileURLToPath(runtime)),
          loader: "ts"
        },
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        target: "es2022",
        logLevel: "silent"
      });
      const mutant = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
      const prepared = prepare(history, mutant.createCompiledClockPreparation);
      expect(() => assertOrthogonal(prepared, history)).toThrow();
    }
  });
});
