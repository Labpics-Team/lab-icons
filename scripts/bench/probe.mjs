import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { assertRemoteBenchmark } from './measurement.js';

assertRemoteBenchmark();
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
global.gc();
const before = process.memoryUsage();
const started = performance.now();
const module = await import(pathToFileURL(request.modulePath).href);
const importMs = performance.now() - started;
const create = request.kind === 'static' ? () => module.accessibilityOutline : request.sliced ? () => request.axes ? module.glyph({ axes: request.axes }) : module.glyph() : () => module.glyph({ icon: request.icon, ...(request.axes ? { axes: request.axes } : {}) });
const svgOf = (value) => typeof value === 'string' ? value : value.svg;
const firstStarted = performance.now();
const firstValue = create();
const first = svgOf(firstValue);
const firstSvgMs = performance.now() - firstStarted;
if (typeof first !== 'string' || !first.startsWith('<svg') || !first.includes('</svg>')) throw new Error('benchmark: consumer не получил SVG');
let completedBytes = 0;
const renderStarted = performance.now();
for (let index = 0; index < request.count; index++) completedBytes += svgOf(create()).length;
const svgGenerationMs = performance.now() - renderStarted;
if (completedBytes !== first.length * request.count) throw new Error('benchmark: потеря или изменение полезного результата');
const warmStarted = performance.now();
for (let index = 0; index < 100; index++) await import(pathToFileURL(request.modulePath).href);
const warmImportMs = (performance.now() - warmStarted) / 100;
const allocated = process.memoryUsage();
const gcStarted = performance.now();
global.gc();
const cleanupMs = performance.now() - gcStarted;
const retained = process.memoryUsage();
const metrics = { count: request.count, completed: request.count, completedBytes, svgSha256: createHash('sha256').update(first).digest('hex'), importMs, firstSvgMs, svgGenerationMs, warmImportMs, cleanupMs, lifecycleMs: performance.now() - started, heapBefore: before.heapUsed, heapAfterGeneration: allocated.heapUsed, heapRetained: retained.heapUsed, rss: retained.rss, resourceUsage: process.resourceUsage() };
// Oracle-инструменты загружаются после observations и не входят в consumer heap/import.
const { observeAuthorGlyph, svgComplexity } = await import('./author-oracle.js');
metrics.complexity = svgComplexity(first);
if (request.inspectAuthor) {
  Object.assign(metrics, observeAuthorGlyph(firstValue, module[request.variant ?? 'outline'], first));
}
console.log(JSON.stringify(metrics));
