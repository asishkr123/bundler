import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/graph.mjs';
import { fixture } from '../support/fixture.mjs';

test('E1 breadth first paths choose shortest length, then entry and source edge order', async () => {
  await fixture({
    'a.js': "import './deep.js'; import './left.js'; import './right.js';",
    'b.js': "import './shared.js';",
    'deep.js': "import './middle.js';",
    'middle.js': "import './shared.js';",
    'left.js': "import './tie.js';",
    'right.js': "import './tie.js';",
    'shared.js': 'export const shared = 1;',
    'tie.js': 'export const tie = 1;'
  }, async root => {
    const graph = await buildGraph(['a.js', 'b.js'], root);
    assert.deepEqual(graph.why['shared.js'], ['b.js', 'shared.js']);
    assert.deepEqual(graph.why['tie.js'], ['a.js', 'left.js', 'tie.js']);
    const reversed = await buildGraph(['b.js', 'a.js'], root);
    assert.deepEqual(reversed.entries, ['b.js', 'a.js']);
    assert.deepEqual(reversed.why['shared.js'], ['b.js', 'shared.js']);
  });
});

test('E2 cycle paths terminate and source size counts UTF-8 bytes', async () => {
  await fixture({
    'a.js': "import './b.js'; export const text = 'é';",
    'b.js': "import './a.js';"
  }, async root => {
    const graph = await buildGraph(['a.js'], root);
    assert.deepEqual(graph.why['a.js'], ['a.js']);
    assert.deepEqual(graph.why['b.js'], ['a.js', 'b.js']);
    assert.equal(graph.modules.find(m => m.id === 'a.js').bytes,
      Buffer.byteLength("import './b.js'; export const text = 'é';", 'utf8'));
  });
});

test('E3 schema, module order, edge order, and paths serialize deterministically', async () => {
  await fixture({
    'z.js': "import './b.js'; import './a.js';",
    'b.js': 'export const b = 1;',
    'a.js': 'export const a = 1;'
  }, async root => {
    const first = await buildGraph(['z.js'], root);
    const second = await buildGraph(['z.js'], root);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.schemaVersion, 1);
    assert.deepEqual(first.modules.map(m => m.id), ['a.js', 'b.js', 'z.js']);
    assert.deepEqual(first.modules.find(m => m.id === 'z.js').imports.map(e => e.target), ['b.js', 'a.js']);
    assert.deepEqual(Object.keys(first.why), ['a.js', 'b.js', 'z.js']);
  });
});
