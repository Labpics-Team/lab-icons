#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFreezeBaselineCli } from './lib/baseline-cli.js';

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runFreezeBaselineCli({ argv: process.argv.slice(2), toolRoot });
