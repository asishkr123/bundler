import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { fixture } from '../support/fixture.mjs';

function capture() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, get value() { return value; } };
}

test('L1 inspect one or multiple entries writes complete JSON and unique count', async () => {
  await fixture({
    'a.js': "import './shared.js';",
    'b.js': "import './shared.js';",
    'shared.js': 'export const value = 1;'
  }, async root => {
    const stdout = capture();
    const stderr = capture();
    assert.equal(await runCli(['inspect', 'a.js'], { root, stdout: stdout.stream, stderr: stderr.stream }), 0);
    assert.match(stdout.value, /Found 2 modules/);
    assert.equal(stderr.value, '');
    assert.equal((await readFile(path.join(root, 'dist/graph.json'), 'utf8')).endsWith('\n'), true);
    const secondOut = capture();
    assert.equal(await runCli(['inspect', 'a.js', 'b.js'], {
      root, stdout: secondOut.stream, stderr: stderr.stream
    }), 0);
    const graph = JSON.parse(await readFile(path.join(root, 'dist/graph.json'), 'utf8'));
    assert.deepEqual(graph.entries, ['a.js', 'b.js']);
    assert.equal(graph.modules.length, 3);
    assert.match(secondOut.value, /Found 3 modules/);
  });
});

test('L2 usage and failures return nonzero without replacing an old report', async () => {
  await fixture({ 'good.js': 'export const good = 1;', 'broken.js': 'import {' }, async root => {
    const stdout = capture();
    const stderr = capture();
    const opts = { root, stdout: stdout.stream, stderr: stderr.stream };
    for (const args of [[], ['other', 'good.js'], ['serve', 'good.js'],
      ['serve', 'good.js', 'broken.js']]) {
      assert.equal(await runCli(args, opts), 2);
    }
    assert.match(stderr.value, /Usage:/);
    assert.match(stderr.value, /serve supports only/);
    assert.equal(await runCli(['inspect', 'good.js'], opts), 0);
    const report = await readFile(path.join(root, 'dist/graph.json'), 'utf8');
    for (const entry of ['missing.js', 'broken.js']) {
      const beforeOut = stdout.value;
      assert.equal(await runCli(['inspect', entry], opts), 1);
      assert.equal(stdout.value, beforeOut);
      assert.equal(await readFile(path.join(root, 'dist/graph.json'), 'utf8'), report);
    }
    assert.match(stderr.value, /Task 1 inspect failed/);
    assert.match(stderr.value, /not updated/);
    assert.equal((await stat(path.join(root, 'dist'))).isDirectory(), true);
  });
});

test('L2 a first failing inspect creates no report', async () => {
  await fixture({ 'broken.js': 'import {' }, async root => {
    const stderr = capture();
    assert.equal(await runCli(['inspect', 'broken.js'], { root, stderr: stderr.stream }), 1);
    await assert.rejects(readFile(path.join(root, 'dist/graph.json')), { code: 'ENOENT' });
    assert.match(stderr.value, /Cannot parse broken\.js/);
  });
});
