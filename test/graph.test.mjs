import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/graph.mjs';
import { fixture } from '../support/fixture.mjs';

test('G1 follows all supported static import and re-export forms once per specifier', async () => {
  await fixture({
    'entry.js': `import './side.js';
      import named from './default.js';
      import { value } from './named.js';
      import * as everything from './namespace.js';
      export * from './star.js';
      export { other } from './reexport.js';
      import './side.js';
      void named; void value; void everything;`,
    'side.js': 'export const side = 1;',
    'default.js': 'export default 1;',
    'named.js': 'export const value = 1;',
    'namespace.js': 'export const ns = 1;',
    'star.js': 'export const star = 1;',
    'reexport.js': 'export const other = 1;'
  }, async root => {
    const graph = await buildGraph(['entry.js'], root);
    assert.deepEqual(graph.modules.find(m => m.id === 'entry.js').imports.map(e => e.specifier), [
      './side.js', './default.js', './named.js', './namespace.js', './star.js', './reexport.js'
    ]);
    assert.equal(graph.modules.length, 7);
  });
});

test('G2 strings and comments that resemble imports do not create edges', async () => {
  await fixture({ 'entry.js': `const text = "import './fake.js'";
    // import './other.js';
    /* export * from './third.js'; */
    export { text };` }, async root => {
    const graph = await buildGraph(['entry.js'], root);
    assert.deepEqual(graph.modules[0].imports, []);
  });
});

test('G3 self import, cycle, diamond, and shared entries terminate with complete edges', async () => {
  await fixture({
    'a.js': "import './a.js'; import './b.js'; import './left.js'; import './right.js';",
    'b.js': "import './a.js'; import './shared.js';",
    'left.js': "import './shared.js';",
    'right.js': "import './shared.js';",
    'shared.js': 'export const shared = 1;'
  }, async root => {
    const graph = await buildGraph(['a.js', 'b.js'], root);
    assert.equal(graph.modules.length, 5);
    assert.deepEqual(graph.modules.find(m => m.id === 'a.js').imports.map(e => e.target), [
      'a.js', 'b.js', 'left.js', 'right.js'
    ]);
    assert.deepEqual(graph.modules.find(m => m.id === 'b.js').imports.map(e => e.target), [
      'a.js', 'shared.js'
    ]);
  });
});

test('G4 malformed module names the source file', async () => {
  await fixture({ 'broken.js': 'import {' }, async root => {
    await assert.rejects(buildGraph(['broken.js'], root), /Cannot parse broken\.js/);
  });
});

test('G5 dynamic import is omitted even for a literal local target', async () => {
  await fixture({
    'entry.js': "export async function load() { return import('./lazy.js'); }",
    'lazy.js': 'export default 1;'
  }, async root => {
    const graph = await buildGraph(['entry.js'], root);
    assert.deepEqual(graph.modules.map(m => m.id), ['entry.js']);
    assert.equal('lazy.js' in graph.why, false);
  });
});
