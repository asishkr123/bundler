import { createServer } from 'node:http';
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildGraph } from './graph.mjs';
import { createRequestHandler } from './server.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node --experimental-vm-modules src/cli.mjs <inspect|serve> <entry.js> [more entries...]\n';

async function writeGraphAtomically(graph, root) {
  const dir = path.join(root, 'dist');
  await mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `.graph-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, path.join(dir, 'graph.json'));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function startDemo(graph, root, stdout, stderr) {
  const rootReal = await realpath(root);
  const server = createServer(createRequestHandler({ rootReal, graph }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4173, '127.0.0.1', () => {
      server.off('error', reject);
      server.on('error', error => {
        stderr.write(`Demo server error: ${error.message}\n`);
        process.exitCode = 1;
        server.close();
      });
      resolve();
    });
  });
  stdout.write('Demo: http://127.0.0.1:4173/\n');
  return 0;
}

export async function runCli(argv, options = {}) {
  const { root = projectRoot, stdout = process.stdout, stderr = process.stderr } = options;
  const [command, ...entries] = argv;
  if (!['inspect', 'serve'].includes(command) || entries.length === 0 ||
      (command === 'serve' && entries.length !== 1)) {
    stderr.write(usage);
    return 2;
  }
  if (command === 'serve' && entries[0] !== 'examples/vanilla/main.js') {
    stderr.write(`serve supports only examples/vanilla/main.js in Task 1\n${usage}`);
    return 2;
  }
  try {
    const graph = await buildGraph(entries, root);
    if (command === 'serve') return await startDemo(graph, root, stdout, stderr);
    await writeGraphAtomically(graph, root);
    stdout.write(`Found ${graph.modules.length} modules; wrote dist/graph.json\n`);
    for (const module of graph.modules) {
      stdout.write(`${module.id} <- ${graph.why[module.id].join(' -> ')}\n`);
    }
    return 0;
  } catch (error) {
    const reportNote = command === 'inspect' ? ' Existing graph.json, if any, was not updated.' : '';
    stderr.write(`Task 1 ${command} failed: ${error.message}.${reportNote}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
