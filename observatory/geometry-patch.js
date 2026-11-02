/** Готовая SVG-проекция меняет только объявленную общую часть. Группы состояний
 * и их видимая opacity остаются у существующего исполнителя движения. */
export function applyEnclosurePatch(root, patch, identity) {
  if (patch?.contract !== 'labpics.symbol-geometry-patch/1' || patch.version !== 1 ||
      patch.group !== identity.group || patch.variant !== identity.variant ||
      patch.partId !== identity.enclosurePartId || !patch.attributes ||
      Object.keys(patch.attributes).join(',') !== 'd' ||
      typeof patch.attributes.d !== 'string' || !patch.attributes.d.length) {
    throw new Error('Обновление не соответствует объявленной общей оболочке.');
  }
  const matches = [...root.querySelectorAll('[data-part]')]
    .filter(node => node.dataset.part === patch.partId);
  const node = matches[0];
  if (matches.length !== 1 || node.tagName.toLowerCase() !== 'path' ||
      node.dataset.role !== 'container' || node.closest('g[data-state]')) {
    throw new Error('Общая оболочка должна быть отдельной единственной SVG-частью.');
  }
  node.setAttribute('d', patch.attributes.d);
}

/** Экспорт снимает последнюю видимую смесь, не завершает и не прерывает движение. */
export function visibleStateSvg(root, identity, color) {
  const source = root.querySelector('svg');
  if (!source) throw new Error('Нет SVG для экспорта видимого состояния.');
  const clone = source.cloneNode(true);
  const sourceGroups = [...source.querySelectorAll('g[data-state][data-part]')];
  const cloneGroups = [...clone.querySelectorAll('g[data-state][data-part]')];
  const sources = new Map(sourceGroups.map(node => [node.dataset.part, node]));
  const copies = new Map(cloneGroups.map(node => [node.dataset.part, node]));
  if (sourceGroups.length !== identity.states.length || cloneGroups.length !== identity.states.length ||
      sources.size !== sourceGroups.length || copies.size !== cloneGroups.length) {
    throw new Error('Экспорт требует всех объявленных групп состояний.');
  }
  for (const state of identity.states) {
    const node = sources.get(state.partId), copy = copies.get(state.partId);
    if (!node || !copy) {
      throw new Error('Экспорт требует всех объявленных групп состояний.');
    }
    const value = getComputedStyle(node).opacity;
    if (!value || !Number.isFinite(Number(value))) throw new Error('Видимая opacity не определена.');
    copy.style.opacity = value;
    copy.setAttribute('opacity', value);
  }
  clone.style.color = color;
  return new XMLSerializer().serializeToString(clone);
}
