import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildGraph } from '../src/graph.mjs';
import { fixture } from '../support/fixture.mjs';

test('R1 exact, extension, index, parent, and precedence resolution', async () => {
  await fixture({
    'src/main.js': "import './util'; import './exact.mjs'; import './nested'; import '../shared.js';",
    'src/util.js': 'export const value = 1;',
    'src/util.mjs': 'export const value = 2;',
    'src/exact.mjs': 'export const exact = 1;',
    'src/nested/index.js': 'export const nested = 1;',
    'shared.js': 'export const shared = 1;'
  }, async root => {
    const graph = await buildGraph(['src/main.js'], root);
    assert.deepEqual(graph.modules.find(m => m.id === 'src/main.js').imports.map(e => e.target), [
      'src/util.js', 'src/exact.mjs', 'src/nested/index.js', 'shared.js'
    ]);
    assert.equal(graph.modules.some(m => m.id === 'src/util.mjs'), false);
  });
});

test('R2 missing entries and dependencies retain context; directories are not files', async () => {
  await fixture({ 'entry.js': "import './missing.js';" }, async root => {
    await mkdir(path.join(root, 'folder.js'));
    await assert.rejects(buildGraph(['no.js'], root), /Cannot resolve entry "no.js"/);
    await assert.rejects(buildGraph(['entry.js'], root), /Cannot resolve Import "\.\/missing\.js" from entry\.js/);
    await assert.rejects(buildGraph(['folder.js'], root), /Entry is not a file/);
  });
});

test('R3 unsupported specifiers include importer and reject a JS alias to text', async () => {
  await fixture({
    'bare.js': "import 'react';",
    'absolute.js': "import '/other.js';",
    'query.js': "import './x.js?v=1';",
    'hash.js': "import './x.js#part';",
    'alias-entry.js': "import './alias.js';",
    'data.txt': 'export default 1;'
  }, async root => {
    for (const [name, spec] of [
      ['bare.js', 'react'], ['absolute.js', '/other.js'],
      ['query.js', './x.js?v=1'], ['hash.js', './x.js#part']
    ]) {
      await assert.rejects(buildGraph([name], root), error =>
        error.message.includes(name) && error.message.includes(spec));
    }
    await symlink('data.txt', path.join(root, 'alias.js'));
    await assert.rejects(buildGraph(['alias-entry.js'], root), /alias\.js.*alias-entry\.js.*non-JS/);
  });
});

test('R4 parent escapes and symlink targets outside root are rejected', async () => {
  await fixture({
    'parent.js': "import '../outside.js';",
    'linked.js': "import './outside-link.js';"
  }, async root => {
    await assert.rejects(buildGraph(['parent.js'], root), /escapes the project root/);
    const outside = await mkdtemp(path.join(tmpdir(), 'module-atlas-outside-'));
    try {
      await writeFile(path.join(outside, 'target.js'), 'export const secret = 1;');
      await symlink(path.join(outside, 'target.js'), path.join(root, 'outside-link.js'));
      await assert.rejects(buildGraph(['linked.js'], root), /escapes the project root/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('R5 real-file aliases collapse while entry argument order is preserved', async () => {
  await fixture({
    'a.js': "import './shared.js'; import './alias.js';",
    'b.js': "import './alias.js';",
    'shared.js': 'export const value = 1;'
  }, async root => {
    await symlink('shared.js', path.join(root, 'alias.js'));
    const graph = await buildGraph(['b.js', 'a.js', 'alias.js'], root);
    assert.deepEqual(graph.entries, ['b.js', 'a.js', 'shared.js']);
    assert.deepEqual(graph.modules.map(m => m.id), ['a.js', 'b.js', 'shared.js']);
    assert.deepEqual(graph.modules.find(m => m.id === 'a.js').imports.map(e => e.target), [
      'shared.js', 'shared.js'
    ]);
    assert.deepEqual(graph.why['shared.js'], ['shared.js']);
  });
});
