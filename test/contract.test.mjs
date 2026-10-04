import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildGraph } from '../src/graph.mjs';
import { fixture } from '../support/fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('C1 sample graph matches the complete schema contract', async () => {
  assert.deepEqual(await buildGraph(['examples/vanilla/main.js'], root), {
    schemaVersion: 1,
    root: '.',
    entries: ['examples/vanilla/main.js'],
    modules: [
      { id: 'examples/vanilla/main.js', bytes: 267, imports: [
        { specifier: './message.js', target: 'examples/vanilla/message.js' }
      ] },
      { id: 'examples/vanilla/message.js', bytes: 107, imports: [
        { specifier: './suffix.js', target: 'examples/vanilla/suffix.js' }
      ] },
      { id: 'examples/vanilla/suffix.js', bytes: 74, imports: [] }
    ],
    why: {
      'examples/vanilla/main.js': ['examples/vanilla/main.js'],
      'examples/vanilla/message.js': ['examples/vanilla/main.js', 'examples/vanilla/message.js'],
      'examples/vanilla/suffix.js': [
        'examples/vanilla/main.js', 'examples/vanilla/message.js', 'examples/vanilla/suffix.js'
      ]
    }
  });
});

test('C2 fresh processes serialize identically without machine paths', () => {
  const script = `import { buildGraph } from './src/graph.mjs';\n` +
    `process.stdout.write(JSON.stringify(await buildGraph(['examples/vanilla/main.js'], process.cwd())));`;
  const run = () => spawnSync(process.execPath, ['--no-warnings', '--experimental-vm-modules',
    '--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  const a = run();
  const b = run();
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stdout.includes(path.resolve(root)), false);
  assert.equal(a.stdout.includes('timestamp'), false);
});

test('C3 unsupported static syntax fails while dynamic import stays out of graph', async () => {
  await fixture({
    'bare.js': "import 'react';",
    'style.js': "import './style.css';",
    'attributes.js': "import data from './data.js' with { type: 'json' };",
    'dynamic.js': "import('./lazy.js');",
    'lazy.js': 'export default 1;'
  }, async dir => {
    await assert.rejects(buildGraph(['bare.js'], dir), /react.*bare\.js/);
    await assert.rejects(buildGraph(['style.js'], dir), /\.\/style\.css.*style\.js/);
    await assert.rejects(buildGraph(['attributes.js'], dir), /Unsupported import attributes or phase/);
    assert.deepEqual((await buildGraph(['dynamic.js'], dir)).modules.map(m => m.id), ['dynamic.js']);
  });
});
