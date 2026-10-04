async function initInspector() {
  const panel = document.querySelector('#module-atlas');
  let graph;
  try {
    const response = await fetch('/__graph', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Graph request returned ${response.status}`);
    graph = await response.json();
    if (graph.schemaVersion !== 1) throw new Error('Unsupported graph schema');
  } catch (error) {
    panel.textContent = `Graph explanation unavailable: ${error.message}`;
    return;
  }
  const moduleByPath = new Map(graph.modules.map(module => [`/${module.id}`, module]));
  let liveUpdates = false;

  function reasonFor(pathname) {
    const module = moduleByPath.get(pathname);
    if (module) return `Static inclusion: ${graph.why[module.id].join(' → ')}`;
    if (pathname === '/examples/vanilla/style.css') return 'HTML stylesheet link; outside JS graph';
    if (pathname === '/src/browser-inspector.mjs') return 'HTML module script; outside app graph';
    if (pathname === '/examples/vanilla/feature.js') {
      return 'Observed feature request; demo button contains a dynamic import; outside Task 1 static graph';
    }
    return 'Observed request; outside Task 1 static graph';
  }

  function addCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = String(value);
    row.append(cell);
  }

  function render() {
    const resources = performance.getEntriesByType('resource')
      .filter(item => /\.(?:js|mjs|css)(?:[?#]|$)/.test(item.name))
      .sort((a, b) => a.startTime - b.startTime);
    panel.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = `${graph.modules.length} static modules; ${resources.length} observed resources`;
    panel.append(heading);
    const note = document.createElement('p');
    note.textContent = 'Static paths explain inclusion. Timings are browser observations, not execution order.';
    panel.append(note);
    if (!liveUpdates) {
      const refresh = document.createElement('button');
      refresh.textContent = 'Refresh observations';
      refresh.addEventListener('click', render);
      panel.append('Live timing updates unavailable. ', refresh);
    }
    const table = document.createElement('table');
    const header = document.createElement('tr');
    for (const label of ['Resource', 'Start (ms)', 'Transfer (bytes)', 'Explanation']) {
      const cell = document.createElement('th');
      cell.textContent = label;
      header.append(cell);
    }
    table.append(header);
    for (const item of resources) {
      const row = document.createElement('tr');
      const pathname = new URL(item.name).pathname;
      const start = Number.isFinite(item.startTime) ? item.startTime.toFixed(1) : 'Unavailable';
      const size = Number.isFinite(item.transferSize) && item.transferSize > 0
        ? String(item.transferSize)
        : 'Unavailable (zero or missing; cache possible)';
      for (const value of [pathname, start, size, reasonFor(pathname)]) addCell(row, value);
      table.append(row);
    }
    panel.append(table);
  }

  try {
    if (typeof PerformanceObserver === 'function') {
      const observer = new PerformanceObserver(render);
      observer.observe({ type: 'resource', buffered: true });
      liveUpdates = true;
    }
  } catch {
    liveUpdates = false;
  }
  window.addEventListener('load', render);
  render();
}

void initInspector();
