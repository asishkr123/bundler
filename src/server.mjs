import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8']
]);
const publicFiles = new Map([
  ['/', 'examples/vanilla/index.html'],
  ['/src/browser-inspector.mjs', 'src/browser-inspector.mjs'],
  ['/examples/vanilla/main.js', 'examples/vanilla/main.js'],
  ['/examples/vanilla/message.js', 'examples/vanilla/message.js'],
  ['/examples/vanilla/suffix.js', 'examples/vanilla/suffix.js'],
  ['/examples/vanilla/feature.js', 'examples/vanilla/feature.js'],
  ['/examples/vanilla/style.css', 'examples/vanilla/style.css']
]);

function reply(status, body, contentType = 'text/plain; charset=utf-8') {
  return {
    status,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
    body: Buffer.isBuffer(body) ? body : Buffer.from(body)
  };
}

export async function routeRequest(rawUrl, method, { rootReal, graph }) {
  if (method !== 'GET' && method !== 'HEAD') return reply(405, 'Method not allowed');
  let pathname;
  try {
    const rawPath = rawUrl.split(/[?#]/, 1)[0];
    if (!rawPath.startsWith('/')) return reply(400, 'Bad request');
    pathname = decodeURIComponent(rawPath);
    if (pathname.includes('\\') || pathname.split('/').includes('..')) {
      return reply(404, 'Not found');
    }
  } catch {
    return reply(400, 'Bad request');
  }
  if (pathname === '/__graph') {
    return reply(200, JSON.stringify(graph), 'application/json; charset=utf-8');
  }
  const relative = publicFiles.get(pathname);
  if (!relative) return reply(404, 'Not found');
  const expected = path.resolve(rootReal, relative);
  try {
    const realFile = await realpath(expected);
    if (realFile !== expected) return reply(403, 'Forbidden');
    if (!(await stat(realFile)).isFile()) return reply(404, 'Not found');
    return reply(200, await readFile(realFile), contentTypes.get(path.extname(realFile)));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return reply(404, 'Not found');
    return reply(500, 'Internal server error');
  }
}

export function createRequestHandler(context) {
  return async (request, response) => {
    try {
      const result = await routeRequest(request.url || '/', request.method || 'GET', context);
      response.writeHead(result.status, result.headers);
      response.end(request.method === 'HEAD' ? undefined : result.body);
    } catch {
      response.writeHead(500, {
        'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'
      });
      response.end('Internal server error');
    }
  };
}
