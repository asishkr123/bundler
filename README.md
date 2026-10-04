# Module Atlas — Task 1

Module Atlas currently inspects a **static local ESM source graph**. It reports why each reachable JavaScript module is included, then shows actual resource requests for a small native ESM browser demo. It does not create a bundle.

## Requirements and commands

Use Node.js **24.4.0 or newer**. The current implementation uses the experimental `vm.SourceTextModule` API. No npm packages need to be installed.

```sh
npm test
npm run inspect
npm run demo
```

`npm run inspect` analyzes `examples/vanilla/main.js`, writes `dist/graph.json`, and prints the inclusion chain for each module. `npm run demo` listens on `127.0.0.1:4173`; open <http://127.0.0.1:4173/>. Port binding must be permitted by your environment.

To inspect other local ESM entries from the project root:

```sh
node --no-warnings --experimental-vm-modules src/cli.mjs inspect path/to/entry.js
node --no-warnings --experimental-vm-modules src/cli.mjs inspect first.js second.mjs
```

The `serve <entry>` command accepts only `examples/vanilla/main.js`. Its page and public routes are fixed to that demo. Invalid usage exits 2; a graph or server error exits 1. Inspect builds the full graph before replacing `dist/graph.json`; a failed run leaves any older report in place and labels it stale in the diagnostic.

## Graph contract

Inputs are existing local `.js` or `.mjs` entries. The analyzer follows relative static `import` and `export ... from` references, including side-effect imports. It accepts `./` and `../` imports whose real targets remain inside the project root. For an extensionless specifier it tries `.js`, `.mjs`, `/index.js`, then `/index.mjs`. Explicit `.js` and `.mjs` specifiers resolve exactly. Bare or absolute imports, query/hash suffixes, import attributes/phases, other extensions, and files outside the root fail with context.

Each module ID is the canonical real file path relative to the real project root, using `/` separators. In-root symlink aliases collapse to one record; outside symlinks and aliases to non-JS files are rejected. `entries` preserves argument order, including repeated canonical entries. Each module has `id`, UTF-8 `bytes`, and `imports` edges with `specifier` and `target`. Repeated occurrences of the same specifier make one edge, ordered by first static occurrence. `modules` and `why` keys use ordinal ID order.

`why[id]` is one **shortest static inclusion path** from an entry to `id`. Equal-length paths prefer the declared entry order, then source import order. It explains inclusion; it does not identify the browser request initiator, execution order, or every possible path.

For the supplied demo, the relevant shape is:

```json
{
  "schemaVersion": 1,
  "root": ".",
  "entries": ["examples/vanilla/main.js"],
  "modules": [
    {"id":"examples/vanilla/main.js","bytes":267,"imports":[{"specifier":"./message.js","target":"examples/vanilla/message.js"}]},
    {"id":"examples/vanilla/message.js","bytes":107,"imports":[{"specifier":"./suffix.js","target":"examples/vanilla/suffix.js"}]},
    {"id":"examples/vanilla/suffix.js","bytes":74,"imports":[]}
  ],
  "why": {
    "examples/vanilla/main.js":["examples/vanilla/main.js"],
    "examples/vanilla/message.js":["examples/vanilla/main.js","examples/vanilla/message.js"],
    "examples/vanilla/suffix.js":["examples/vanilla/main.js","examples/vanilla/message.js","examples/vanilla/suffix.js"]
  }
}
```

## Browser comparison

On a fresh load, the page greets the developer. The browser requests the HTML-linked CSS, the page's two module scripts, and the static app modules `main.js`, `message.js`, and `suffix.js`. The inspector uses Resource Timing to show observed JS/CSS requests beside static graph explanations. Open DevTools Network before reloading to compare the requests. Confirm `feature.js` is absent before clicking **Load a feature on demand**. Click once; the message changes and the browser requests `feature.js`. That request is labelled outside the Task 1 static graph because the demo uses `import()`.

Transfer size can be unavailable or zero because of browser cache or API behavior; the table labels that state as unavailable. If live observation is unavailable, use **Refresh observations**. If the graph request fails, the page shows an error while the demo button remains usable. The inspector matches graph IDs to browser URLs for this shipped demo, which has no symlinks.

The browser check record is [test/browser-verification.html](test/browser-verification.html). The detailed [implementation plan](docs/task-1-code-implementation-plan.html), [Task 1 brief](docs/task-1-agent-implementation-brief.html), and [architecture](docs/architecture.html) describe the scope and later slices.

## Limits

Task 1 does not analyze dynamic import targets or CSS dependencies. It does not emit production bundles, chunks, rewritten imports, TypeScript/JSX, CommonJS, package imports, source maps, minified output, or performance comparisons. The HTTP server is a fixed local demo server, not a production server.
