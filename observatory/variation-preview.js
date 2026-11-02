/** UI читает допущенную возможность; интерпретация геометрии остаётся в пакете. */
export function authoredVariationCapability(capabilities) {
  const variation = capabilities?.variation;
  return variation?.version === 1 && variation.law === 'dots.affine' && variation.targets?.svg === 'supported'
    ? variation : null;
}

/** Сравниваются готовые production SVG в общей исходной системе координат. */
export function renderVariationComparison(sourceSvg, modifiedSvg, viewBox, view, instanceId) {
  if (!['overlay', 'difference'].includes(view) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(instanceId) ||
      !Array.isArray(viewBox) || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new TypeError('Нужны вид сравнения и конечный viewport готового GlyphIR.');
  }
  const [x, y, width, height] = viewBox;
  const frame = `<svg viewBox="${viewBox.join(' ')}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" data-variation-comparison="${view}">`;
  // Вложенный viewport начинается в (0,0), даже когда авторский viewBox смещён.
  const viewport = svg => x || y ? `<g transform="translate(${x} ${y})">${svg}</g>` : svg;
  if (view === 'overlay') return `${frame}<g class="overlay-original" data-comparison="source">${viewport(sourceSvg)}</g>` +
    `<g class="overlay-candidate" data-comparison="modified">${viewport(modifiedSvg)}</g></svg>`;
  const withoutModified = `${instanceId}-without-modified`, withoutSource = `${instanceId}-without-source`;
  const mask = (id, svg) => `<mask id="${id}" mask-type="luminance" maskUnits="userSpaceOnUse" ` +
    `x="${x}" y="${y}" width="${width}" height="${height}">` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff"/>` +
    `<g color="#000">${viewport(svg)}</g></mask>`;
  // Две направленные разности сохраняют смысл цветов: что убрано и добавлено.
  return `${frame}<defs>${mask(withoutModified, modifiedSvg)}${mask(withoutSource, sourceSvg)}</defs>` +
    `<g class="difference-original" data-comparison="source" mask="url(#${withoutModified})">${viewport(sourceSvg)}</g>` +
    `<g class="difference-candidate" data-comparison="modified" mask="url(#${withoutSource})">${viewport(modifiedSvg)}</g></svg>`;
}
