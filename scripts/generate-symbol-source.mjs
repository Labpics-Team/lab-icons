import { fileURLToPath } from 'node:url';
import { writeSymbolSourceProjections } from './lib/symbol-source.js';
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new TypeError('expected --check or no arguments');
const result = writeSymbolSourceProjections(fileURLToPath(new URL('..', import.meta.url)), { check: process.argv.includes('--check') });
console.log(`SymbolSource: ${result.families} families; ${result.references} verified references to ${result.components} shared components`);
