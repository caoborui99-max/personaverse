import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {seedPersonas} from '../server/seed-data.js';
const context = {window: {}};
runInNewContext(await readFile(new URL('../js/personas.js', import.meta.url), 'utf8'), context, {timeout: 1000});
assert.deepEqual(JSON.parse(JSON.stringify(context.window.PERSONAS)), seedPersonas,
  'Active frontend catalog must match server seeds exactly; do not overwrite historical previews.');
console.log('PASS: all 12 active frontend personas equal server seeds, including IDs and prompts.');
