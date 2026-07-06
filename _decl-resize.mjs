// _decl-resize.mjs — вставка декларации resize в semantics/anatomy.json (Волна-7).
// Нетрекаемый скрипт, удалить до merge.
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync('semantics/anatomy.json', 'utf8');
const a = JSON.parse(raw);
if (a.glyphs.resize) throw new Error('resize уже задекларирован');

const fitted = JSON.parse(readFileSync('_resize-entry.json', 'utf8'));
const m = fitted.m;
a.glyphs.resize = {
  archetype: 'composite',
  status: { outline: 'hand', filled: 'hand' },
  fidelityToHand: {
    outline: Math.round(m.outline * 1e4) / 1e4,
    filled: Math.round(m.filled * 1e4) / 1e4,
  },
  parts: fitted.entry.parts,
};

const out = JSON.stringify(a, null, 1).replace(/\n/g, '\r\n') + '\r\n';
writeFileSync('semantics/anatomy.json', out);
console.log('resize вставлен; fidelityToHand:', JSON.stringify(a.glyphs.resize.fidelityToHand));
