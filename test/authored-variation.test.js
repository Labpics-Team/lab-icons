import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadAuthorBaseline, authorSymbolPayload } from "../scripts/lib/author-baseline.js";
import { compileAuthorAnatomy } from "../scripts/lib/author-anatomy.js";
import { compileAuthorVariation } from "../scripts/lib/author-variation.js";
import { renderSymbolModule, symbolModuleDeclaration, symbolExportName } from "../scripts/lib/symbol-modules.js";
import { createGlyphCompiler } from "../src/ir/compiler.js";
import { createCompiledGlyph, createCompiledCapabilities } from "../src/ir/symbol-runtime.js";
import { createCompiledVariationGlyph } from "../src/ir/authored-variation.js";
import { compileSymbolEffect } from "../src/motion/index.js";
import { compileLottieGeometry } from "../scripts/lib/lottie-geometry.js";
import { createLottieSymbol } from "../src/lottie/runtime.js";
import { pathBBox, parsePathData } from "../src/core/path-data.js";
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => JSON.parse(readFileSync(new URL(path, new URL("..", import.meta.url)), "utf8"));
const names = ["ellipsis-horizontal", "ellipsis-vertical", "chatbubble-ellipses", "ellipse"];
const manifest = read("semantics/figma-baseline.json");
const grid = read("semantics/grid.json");
const baseline = loadAuthorBaseline(root, { manifest: {
  ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map((icon) => [icon, manifest.icons[icon]]))
} });
const declarations = read("semantics/author-anatomy.json");
const annotations = { ...declarations, icons: Object.fromEntries(names.filter((icon) => declarations.icons[icon]).map((icon) => [icon, declarations.icons[icon]])) };
const contracts = compileAuthorAnatomy(baseline, annotations, grid);
const sources = Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [
  icon,
  Object.fromEntries(Object.entries(variants).map(([variant, source]) => [variant, {
    ...source,
    sourceContract: contracts[`${icon}/${variant}`] ?? source.sourceContract
  }]))
]));
const compiler = createGlyphCompiler({
  catalog: {
    canvas: { viewBox: [0, 0, 24, 24] },
    axes: read("semantics/catalog.json").axes,
    icons: Object.fromEntries(Object.entries(sources).map(([icon, variants]) => [icon, {
      model: null,
      source: Object.fromEntries(Object.entries(variants).map(([variant, source]) => [variant, source.sourceContract]))
    }]))
  },
  anatomy: { version: 1, glyphs: {} },
  grid,
  staticIcons: Object.fromEntries(Object.entries(sources).flatMap(([icon, variants]) => Object.entries(variants).map(([variant, source]) => [symbolExportName(icon, variant), source.artifactSvg])))
});
function symbol(icon) {
  const payload = authorSymbolPayload(icon, sources[icon], compiler);
  const variation = Object.fromEntries(["outline", "filled"].map((variant) => [variant, contracts[`${icon}/${variant}`]?.variation]));
  const capabilities = Object.fromEntries(Object.entries(payload.capabilities).map(([variant, caps]) => [
    variant,
    { ...caps, ...variation[variant] && { variation: {
      version: 1,
      law: "dots.affine",
      geometrySha256: variation[variant].geometrySha256,
      defaults: { dotScale: 1, spacingScale: 1 },
      domain: variation[variant].domain,
      targets: { svg: "supported", webEffect: "existing-part-gestures", lottie: "not-exported", sfSymbols: "not-exported" }
    } } }
  ]));
  return {
    payload,
    capabilities,
    variation,
    glyph: variation.outline && variation.filled ? createCompiledVariationGlyph(icon, payload.source, variation) : createCompiledGlyph(icon, payload.source),
    glyphCapabilities: createCompiledCapabilities(capabilities)
  };
}
const measure = (d) => {
  const b = pathBBox(d);
  return { width: b.maxX - b.minX, height: b.maxY - b.minY, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
};
describe("authored dot geometry: independent variant controls, coupled domain", () => {
  it.each(["ellipsis-horizontal", "ellipsis-vertical"])("%s keeps exact identity and author details in both variants", (icon) => {
    const module = symbol(icon);
    for (const variant of ["outline", "filled"]) {
      const source = module.glyph({ variant });
      expect(module.glyph({ variant, variation: { dotScale: 1, spacingScale: 1 } })).toBe(source);
      expect(module.glyph({ variant, variation: {} })).toBe(source);
      expect(source.parts.map((part) => part.d)).toEqual([...baseline.icons[icon][variant].rawSvg.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]));
      expect(source.parts.map((part) => part.id)).toEqual(["dot-leading", "dot-middle", "dot-trailing"]);
      expect(source.parts.every((part) => part.fillRule === "nonzero" && part.paint.kind === "fill")).toBe(true);
      expect(module.glyphCapabilities(variant).supportedAxes).toEqual([]);
      expect(module.glyphCapabilities(variant).modelState).toBeNull();
    }
    expect(module.payload.source.outline.parts[0].d).not.toBe(module.payload.source.filled.parts[0].d);
  });
  it.each(["ellipsis-horizontal/outline", "ellipsis-horizontal/filled", "ellipsis-vertical/outline", "ellipsis-vertical/filled"])("%s changes real SVG size and spacing independently", (id) => {
    const [icon, variant] = id.split("/"), module = symbol(icon);
    const source = module.glyph({ variant });
    const varied = module.glyph({ variant, variation: { dotScale: 1.1, spacingScale: 0.9 } });
    const original = source.parts.map((part) => measure(part.d)), actual = varied.parts.map((part) => measure(part.d));
    const axis = icon.endsWith("horizontal") ? "x" : "y", cross = axis === "x" ? "y" : "x";
    for (let i = 0; i < 3; i++) {
      expect(actual[i].width / original[i].width).toBeCloseTo(1.1, 11);
      expect(actual[i].height / original[i].height).toBeCloseTo(1.1, 11);
      expect(actual[i][cross]).toBeCloseTo(original[i][cross], 11);
      if (i) expect((actual[i][axis] - actual[i - 1][axis]) / (original[i][axis] - original[i - 1][axis])).toBeCloseTo(0.9, 11);
      expect(varied.parts[i].topologySignature).toBe(source.parts[i].topologySignature);
      expect(varied.parts[i].id).toBe(source.parts[i].id);
      expect(varied.parts[i].d).not.toBe(source.parts[i].d);
      expect(parsePathData(varied.parts[i].d)).toHaveLength(6);
      expect(varied.svg).toContain(`d="${varied.parts[i].d}"`);
      expect(varied.parts[i].provenance.kind).toBe("authored-variation");
    }
    expect(varied.provenance).toMatchObject({
      kind: "authored-variation",
      author: source.provenance.author,
      variation: { law: "dots.affine", parameters: { dotScale: 1.1, spacingScale: 0.9 } }
    });
    expect(Object.isFrozen(varied.parts[0])).toBe(true);
    expect(compileLottieGeometry(varied)).toMatchObject({ ok: false, reason: { code: "AUTHOR_SOURCE_REQUIRED" } });
  });
  it("preserves true differing extrema of the third Filled dot", () => {
    const module = symbol("ellipsis-horizontal");
    const geometry = module.variation.filled.parts;
    expect(geometry[2].pivot[0]).not.toBe(parsePathData(module.payload.source.filled.parts[2].d)[0].x);
    const width = (part) => Math.max(...part.points.map((p) => p[0])) - Math.min(...part.points.map((p) => p[0]));
    expect(width(geometry[2])).not.toBe(width(geometry[1]));
    const varied = module.glyph({ variant: "filled", variation: { dotScale: 1.1 } });
    expect(measure(varied.parts[2].d).width).not.toBe(measure(varied.parts[1].d).width);
  });
  it("publishes derived policy, rejects collapsed/overlapping/clipped and invalid requests", () => {
    const module = symbol("ellipsis-horizontal"), caps = module.glyphCapabilities();
    expect(caps.variation.domain).toMatchObject({ bound: "control-hull", kind: "convex-linear", policy: {
      gridVersion: grid.version,
      marginRatio: grid.ratios.margin,
      minimumGapRatio: grid.ratios.clearanceMin
    } });
    expect(caps.variation.domain.constraints.filter((c) => c.kind === "gap")).toHaveLength(2);
    for (const variation of [{ dotScale: 3, spacingScale: 0.5 }, { dotScale: 1, spacingScale: 3 }]) {
      expect(() => module.glyph({ variation })).toThrow(expect.objectContaining({ code: "VARIATION_OUTSIDE_DOMAIN" }));
    }
    expect(() => module.glyph({ variation: { dotScale: Number.MIN_VALUE } })).toThrow(expect.objectContaining({ code: "VARIATION_UNREPRESENTABLE" }));
    for (const variation of [null, [], { dotScale: 0 }, { dotScale: null }, { dotScale: Infinity }, { spacingScale: -1 }, { radius: 2 }]) {
      expect(() => module.glyph({ variation })).toThrow(expect.objectContaining({ code: "INVALID_VARIATION" }));
    }
    expect(() => module.glyph({ modelMode: "source-only", variation: { dotScale: 1.1 } })).toThrow(expect.objectContaining({ code: "AUTHOR_PARITY_REQUIRED" }));
    expect(() => module.glyph({ axes: { weight: 1.1 }, variation: { dotScale: 1.1 } })).toThrow(expect.objectContaining({ code: "AUTHOR_PARITY_REQUIRED" }));
    const target = createLottieSymbol(module, Object.fromEntries(["outline", "filled"].map((variant) => [variant, compileLottieGeometry(module.payload.source[variant])])));
    expect(target.exportLottie({ variation: { dotScale: 1.1 } })).toMatchObject({ ok: false, reason: { code: "VARIATION_UNSUPPORTED" } });
    expect(target.exportLottie()).toMatchObject({ ok: true });
  });
  it("preserves horizontal opacity gestures and refuses invented vertical motion", () => {
    const horizontal = symbol("ellipsis-horizontal");
    const varied = horizontal.glyph({ variation: { dotScale: 1.1, spacingScale: 0.9 } });
    expect(compileSymbolEffect(varied, horizontal.glyphCapabilities(), "ellipsis-horizontal.activity", { duration: 360 })).toMatchObject({ ok: true, effect: { version: 2 } });
    const vertical = symbol("ellipsis-vertical");
    expect(vertical.glyphCapabilities().motion).toMatchObject({ state: "semantic-parts", gestures: [], tracks: [] });
    expect(compileSymbolEffect(vertical.glyph(), vertical.glyphCapabilities(), "ellipsis-vertical.activity", { duration: 360 })).toMatchObject({ ok: false, reason: { code: "SEMANTIC_MOTION_UNAVAILABLE" } });
  });
  it.each(["chatbubble-ellipses", "ellipse"])("%s does not inherit a triad law from visual similarity", (icon) => {
    const module = symbol(icon);
    for (const variant of ["outline", "filled"]) {
      expect(() => module.glyph({ variant, variation: { dotScale: 1.1 } })).toThrow(expect.objectContaining({ code: "AUTHOR_VARIATION_UNSUPPORTED" }));
      const source = sources[icon][variant];
      expect(() => compileAuthorVariation(source, source.sourceContract.parts, { law: "dots.affine", axis: "x" }, grid)).toThrow(expect.objectContaining({ code: "POSITIVE_PARTS_REQUIRED" }));
    }
  });
  it("rejects source, axis, part polarity and topology drift before projection", () => {
    const source = sources["ellipsis-horizontal"].outline, parts = source.sourceContract.parts;
    expect(() => compileAuthorVariation(
      { ...source, artifactSvg: source.artifactSvg.replace("4.99941", "4.99942") },
      parts,
      { law: "dots.affine", axis: "x" },
      grid
    )).toThrow(expect.objectContaining({ code: "SOURCE_MISMATCH" }));
    expect(() => compileAuthorVariation(source, parts, { law: "dots.affine", axis: "y" }, grid)).toThrow(expect.objectContaining({ code: "CORRESPONDENCE_UNSUPPORTED" }));
    expect(() => compileAuthorVariation(
      source,
      parts.map((p, i) => ({ ...p, role: i ? "content" : "counter" })),
      { law: "dots.affine", axis: "x" },
      grid
    )).toThrow(expect.objectContaining({ code: "POSITIVE_PARTS_REQUIRED" }));
    const drift = structuredClone(annotations);
    drift.icons["ellipsis-horizontal"].outline.masterSha256 = "0".repeat(64);
    expect(() => compileAuthorAnatomy(baseline, drift, grid)).toThrow(expect.objectContaining({ code: "MASTER_MISMATCH" }));
    const module = symbol("ellipsis-horizontal");
    expect(() => createCompiledVariationGlyph(
      "ellipsis-horizontal",
      module.payload.source,
      { outline: module.variation.filled, filled: module.variation.outline }
    )).toThrow(expect.objectContaining({ code: "VARIATION_SOURCE_MISMATCH" }));
  });
  it("slices implementation and types to eligible symbols and leaves ordinary modules unchanged", () => {
    const positive = symbol("ellipsis-horizontal"), negative = symbol("ellipse");
    const module = renderSymbolModule({ ...positive.payload, capabilities: positive.capabilities, variation: positive.variation });
    expect(module).toContain("../ir/variation-runtime.js");
    expect(symbolModuleDeclaration("ellipsis-horizontal", true)).toContain("AuthorVariationGlyphRequest");
    const ordinary = renderSymbolModule(negative.payload);
    expect(ordinary).not.toContain("variation-runtime");
    expect(ordinary).toContain("createCompiledGlyph");
    expect(symbolModuleDeclaration("ellipse")).not.toContain("AuthorVariationGlyphRequest");
  });
});
