import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph } from '../src/graph.mjs';
import { createRequestHandler, routeRequest } from '../src/server.mjs';
import { fixture } from '../support/fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const rootReal = await realpath(root);
const graph = await buildGraph(['examples/vanilla/main.js'], root);

test('S1 public HTML, JS, CSS, and graph routes serve expected body and headers', async () => {
  for (const [url, file, type] of [
    ['/', 'examples/vanilla/index.html', 'text/html'],
    ['/src/browser-inspector.mjs', 'src/browser-inspector.mjs', 'text/javascript'],
    ['/examples/vanilla/main.js', 'examples/vanilla/main.js', 'text/javascript'],
    ['/examples/vanilla/style.css', 'examples/vanilla/style.css', 'text/css']
  ]) {
    const result = await routeRequest(url, 'GET', { rootReal, graph });
    assert.equal(result.status, 200, url);
    assert.match(result.headers['content-type'], new RegExp(type));
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.deepEqual(result.body, await readFile(path.join(root, file)));
  }
  const graphResponse = await routeRequest('/__graph', 'GET', { rootReal, graph });
  assert.equal(graphResponse.status, 200);
  assert.match(graphResponse.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(graphResponse.body.toString()), graph);
});

test('S1 HTTP adapter sends no body on HEAD', async () => {
  let status;
  let headers;
  let body;
  await createRequestHandler({ rootReal, graph })(
    { url: '/examples/vanilla/main.js', method: 'HEAD' },
    { writeHead(code, values) { status = code; headers = values; }, end(value) { body = value; } }
  );
  assert.equal(status, 200);
  assert.match(headers['content-type'], /text\/javascript/);
  assert.equal(body, undefined);
});

test('S2 private, traversal, malformed, and unsupported method requests expose no bytes', async () => {
  for (const [url, method, status] of [
    ['/package.json', 'GET', 404],
    ['/docs/architecture.html', 'GET', 404],
    ['/examples/vanilla/%2e%2e/%2e%2e/package.json', 'GET', 404],
    ['/examples/vanilla/%2e%2e/%2e%2e/', 'GET', 404],
    ['/%E0%A4%A', 'GET', 400],
    ['/', 'POST', 405]
  ]) {
    const result = await routeRequest(url, method, { rootReal, graph });
    assert.equal(result.status, status, url);
    assert.equal(result.body.includes(Buffer.from('module-atlas')), false);
  }
});

test('S2 even an allowlisted URL rejects in-root and outside symlinked files', async () => {
  await fixture({
    'examples/vanilla/index.html': '<h1>public</h1>',
    'examples/vanilla/inside.js': 'inside secret'
  }, async temporaryRoot => {
    const real = await realpath(temporaryRoot);
    const target = path.join(real, 'examples/vanilla/main.js');
    await symlink('inside.js', target);
    const inside = await routeRequest('/examples/vanilla/main.js', 'GET', { rootReal: real, graph });
    assert.equal(inside.status, 403);
    assert.equal(inside.body.includes(Buffer.from('inside secret')), false);
    await rm(target);
    const outside = await mkdtemp(path.join(tmpdir(), 'module-atlas-server-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.js'), 'outside secret');
      await symlink(path.join(outside, 'secret.js'), target);
      const result = await routeRequest('/examples/vanilla/main.js', 'GET', { rootReal: real, graph });
      assert.equal(result.status, 403);
      assert.equal(result.body.includes(Buffer.from('outside secret')), false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
