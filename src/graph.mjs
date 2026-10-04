import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { SourceTextModule } from 'node:vm';

const jsExtensions = new Set(['.js', '.mjs']);
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function insideRoot(root, file, context) {
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${context} escapes the project root: ${file}`);
  }
}

async function createResolver(root) {
  const rootReal = await realpath(root);
  const idOf = file => path.relative(rootReal, file).split(path.sep).join('/');

  async function resolveEntry(entry) {
    if (typeof entry !== 'string' || !jsExtensions.has(path.extname(entry))) {
      throw new Error(`Entry must be .js or .mjs: ${JSON.stringify(entry)}`);
    }
    const requested = path.resolve(rootReal, entry);
    insideRoot(rootReal, requested, `Entry ${JSON.stringify(entry)}`);
    let file;
    try {
      file = await realpath(requested);
    } catch (error) {
      const verb = error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'resolve' : 'access';
      throw new Error(`Cannot ${verb} entry ${JSON.stringify(entry)}: ${error.message}`, { cause: error });
    }
    insideRoot(rootReal, file, `Entry ${JSON.stringify(entry)}`);
    if (!jsExtensions.has(path.extname(file))) {
      throw new Error(`Entry resolves to non-JS file: ${JSON.stringify(entry)}`);
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error(`Entry is not a file: ${JSON.stringify(entry)}`);
    } catch (error) {
      if (!error.code) throw error;
      throw new Error(`Cannot access entry ${JSON.stringify(entry)}: ${error.message}`, { cause: error });
    }
    return file;
  }

  async function resolveLocal(importer, specifier) {
    const context = `Import ${JSON.stringify(specifier)} from ${idOf(importer)}`;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new Error(`${context}: unsupported bare or absolute import`);
    }
    if (specifier.includes('?') || specifier.includes('#')) {
      throw new Error(`${context}: query/hash imports are unsupported`);
    }
    const base = path.resolve(path.dirname(importer), specifier);
    insideRoot(rootReal, base, context);
    const extension = path.extname(base);
    if (extension && !jsExtensions.has(extension)) {
      throw new Error(`${context}: unsupported module extension`);
    }
    const candidates = extension ? [base] : [
      `${base}.js`, `${base}.mjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs')
    ];
    for (const candidate of candidates) {
      try {
        const file = await realpath(candidate);
        insideRoot(rootReal, file, context);
        if (!jsExtensions.has(path.extname(file))) {
          throw new Error(`${context}: resolves to a non-JS file`);
        }
        if ((await stat(file)).isFile()) return file;
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
        if (error.code) throw new Error(`Cannot access ${context}: ${error.message}`, { cause: error });
        throw error;
      }
    }
    throw new Error(`Cannot resolve ${context}`);
  }
  return { idOf, resolveEntry, resolveLocal };
}

function computeWhy(entries, nodes) {
  const found = new Map();
  const queue = entries.map(id => ({ id, chain: [id] }));
  for (let head = 0; head < queue.length; head++) {
    const { id, chain } = queue[head];
    if (found.has(id)) continue;
    found.set(id, chain);
    for (const edge of nodes.get(id).imports) {
      queue.push({ id: edge.target, chain: [...chain, edge.target] });
    }
  }
  return found;
}

export async function buildGraph(entryPaths, root = process.cwd()) {
  if (!Array.isArray(entryPaths) || entryPaths.length === 0) {
    throw new Error('At least one entry is required');
  }
  const { idOf, resolveEntry, resolveLocal } = await createResolver(root);
  const nodes = new Map();

  async function visit(file) {
    const id = idOf(file);
    if (nodes.has(id)) return;
    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read ${id}: ${error.message}`, { cause: error });
    }
    let parsed;
    try {
      parsed = new SourceTextModule(source, { identifier: id });
    } catch (error) {
      throw new Error(`Cannot parse ${id}: ${error.message}`, { cause: error });
    }
    const node = { id, bytes: Buffer.byteLength(source, 'utf8'), imports: [] };
    nodes.set(id, node); // Mark before recursion so cycles terminate.
    const seenSpecifiers = new Set();
    for (const request of parsed.moduleRequests) {
      if (request.phase !== 'evaluation' || Object.keys(request.attributes).length > 0) {
        throw new Error(`Unsupported import attributes or phase ${JSON.stringify(request.specifier)} in ${id}`);
      }
      const { specifier } = request;
      if (seenSpecifiers.has(specifier)) continue;
      seenSpecifiers.add(specifier);
      const target = await resolveLocal(file, specifier);
      node.imports.push({ specifier, target: idOf(target) });
      await visit(target);
    }
  }

  const entries = [];
  for (const entry of entryPaths) {
    const file = await resolveEntry(entry);
    entries.push(idOf(file));
    await visit(file);
  }
  const paths = computeWhy(entries, nodes);
  const modules = [...nodes.values()].sort((a, b) => ordinal(a.id, b.id));
  const why = Object.fromEntries(modules.map(module => [module.id, paths.get(module.id)]));
  return { schemaVersion: 1, root: '.', entries, modules, why };
}
