function embeddedJson(value) {
    return JSON.stringify(value)
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("&", "\\u0026")
        .replaceAll("\u2028", "\\u2028")
        .replaceAll("\u2029", "\\u2029");
}

export function renderHtml(options = {}) {
    const mode = options.mode ?? "canvas";
    if (!["canvas", "standalone"].includes(mode)) {
        throw new Error(`Unsupported repository architecture renderer mode: ${mode}`);
    }
    if (mode === "standalone" && (!options.graph || !options.archivedGraph || !options.metadata)) {
        throw new Error("Standalone rendering requires graph, archivedGraph, and metadata.");
    }

    const standaloneTheme =
        mode === "standalone"
            ? `
    :root {
      --background-color-default: #ffffff;
      --border-color-default: #d0d7de;
      --text-color-default: #1f2328;
      --text-color-muted: #656d76;
      --color-focus-outline: #0969da;
      --true-color-blue: #0969da;
      --true-color-red: #cf222e;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      --font-weight-semibold: 600;
      --text-body-medium: 14px;
      --leading-body-medium: 20px;
      --text-title-medium: 20px;
      --leading-title-medium: 26px;
      --text-code-inline: 12px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background-color-default: #0d1117;
        --border-color-default: #30363d;
        --text-color-default: #e6edf3;
        --text-color-muted: #8b949e;
        --color-focus-outline: #2f81f7;
        --true-color-blue: #58a6ff;
        --true-color-red: #ff7b72;
      }
    }`
            : "";
    const snapshotMarkup =
        mode === "standalone"
            ? `
    <section class="snapshot" aria-label="Snapshot metadata">
      <strong>Committed snapshot</strong>
      <span>Generated <time id="snapshot-created"></time></span>
      <span>Schema <code id="snapshot-schema"></code></span>
      <span>Fingerprint <code id="snapshot-fingerprint"></code></span>
      <span>Graph input revision <code id="snapshot-revision"></code></span>
    </section>`
            : "";
    const refreshMarkup =
        mode === "canvas"
            ? '<button class="toolbar-button" id="refresh">Refresh</button>'
            : "";
    const archiveMarkup =
        options.hasArchivedSnapshot === false
            ? ""
            : '<button class="toolbar-button" id="archive-toggle" aria-pressed="false">Include archived</button>';
    const embeddedDatasets =
        mode === "standalone"
            ? `
  <script type="application/json" id="graph-default">${embeddedJson(options.graph)}</script>
  <script type="application/json" id="graph-archived">${embeddedJson(options.archivedGraph)}</script>
  <script type="application/json" id="page-metadata">${embeddedJson(options.metadata)}</script>`
            : "";
    const runtimeAdapter =
        mode === "canvas"
            ? `
      async function loadGraph() {
        var response = await fetch('/api/graph', { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load architecture data');
        applyGraph(await response.json(), true);
      }

      async function refreshGraph(includeArchived) {
        if (archiveButton) archiveButton.disabled = true;
        refreshButton.disabled = true;
        refreshButton.textContent = 'Scanning…';
        try {
          var query = typeof includeArchived === 'boolean' ? '?includeArchived=' + includeArchived : '';
          var response = await fetch('/api/refresh' + query, { method: 'POST' });
          if (!response.ok) throw new Error('Refresh failed');
          applyGraph(await response.json(), true);
        } finally {
          if (archiveButton) archiveButton.disabled = false;
          refreshButton.disabled = false;
          refreshButton.textContent = 'Refresh';
        }
      }

      function toggleArchived() {
        refreshGraph(!(sourceGraph && sourceGraph.options && sourceGraph.options.includeArchived));
      }

      function startUpdates() {
        var events = new EventSource('/events');
        events.addEventListener('graph', function (event) { applyGraph(JSON.parse(event.data), true); });
      }`
            : `
      var defaultGraph;
      var archivedGraph;
      var pageMetadata;

      function parseEmbedded(id) {
        var element = document.getElementById(id);
        if (!element) throw new Error('Embedded architecture dataset "' + id + '" is missing.');
        var value = JSON.parse(element.textContent);
        if (!value || value.schemaVersion !== 2 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
          throw new Error('Embedded architecture dataset "' + id + '" is incompatible. Regenerate this page.');
        }
        return value;
      }

      function renderSnapshotMetadata() {
        document.getElementById('snapshot-created').textContent = new Date(pageMetadata.generatedAt).toLocaleString();
        document.getElementById('snapshot-schema').textContent = String(pageMetadata.schemaVersion);
        document.getElementById('snapshot-fingerprint').textContent = pageMetadata.fingerprint.slice(0, 12);
        document.getElementById('snapshot-fingerprint').title = pageMetadata.fingerprint;
        document.getElementById('snapshot-revision').textContent = pageMetadata.graphInputRevision || 'unavailable';
      }

      async function loadGraph() {
        defaultGraph = parseEmbedded('graph-default');
        archivedGraph = parseEmbedded('graph-archived');
        pageMetadata = JSON.parse(document.getElementById('page-metadata').textContent);
        if (!pageMetadata || pageMetadata.schemaVersion !== 2 || !pageMetadata.fingerprint) {
          throw new Error('Embedded architecture metadata is missing or incompatible. Regenerate this page.');
        }
        renderSnapshotMetadata();
        applyGraph(defaultGraph, true);
      }

      function toggleArchived() {
        applyGraph(sourceGraph.options.includeArchived ? defaultGraph : archivedGraph, true);
      }

      function startUpdates() {}`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Repository architecture</title>
  <style>
    ${standaloneTheme}
    :root {
      color-scheme: light dark;
      --panel: color-mix(in srgb, var(--background-color-default, #fff) 94%, var(--text-color-default, #1f2328));
      --surface: color-mix(in srgb, var(--background-color-default, #fff) 97%, var(--text-color-default, #1f2328));
      --shadow: 0 8px 24px color-mix(in srgb, var(--text-color-default, #1f2328) 12%, transparent);
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      background: var(--background-color-default, #fff);
      color: var(--text-color-default, #1f2328);
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--text-body-medium, 14px);
      line-height: var(--leading-body-medium, 20px);
    }
    button, input, select { font: inherit; }
    button {
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 7px;
      background: var(--surface);
      color: inherit;
      cursor: pointer;
    }
    button:hover { background: color-mix(in srgb, var(--surface) 88%, var(--text-color-default, #1f2328)); }
    button:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid var(--color-focus-outline, #0969da);
      outline-offset: 2px;
    }
    .app { display: grid; grid-template-rows: auto auto auto 1fr; height: 100%; min-width: 0; }
    body[data-mode="canvas"] .app { grid-template-rows: auto auto 1fr; }
    header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color-default, #d0d7de);
      background: var(--panel);
    }
    h1 {
      margin: 0;
      font-size: var(--text-title-medium, 20px);
      line-height: var(--leading-title-medium, 26px);
      font-weight: var(--font-weight-semibold, 600);
      white-space: nowrap;
    }
    .subtitle { color: var(--text-color-muted, #656d76); white-space: nowrap; }
    .search {
      margin-left: auto;
      width: min(340px, 35vw);
      padding: 7px 10px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 7px;
      background: var(--background-color-default, #fff);
      color: inherit;
    }
    .toolbar-button { padding: 7px 11px; font-weight: var(--font-weight-semibold, 600); }
    .toolbar-button.active {
      border-color: var(--color-focus-outline, #0969da);
      background: color-mix(in srgb, var(--color-focus-outline, #0969da) 14%, var(--surface));
    }
    .toolbar-button[disabled] { opacity: .6; cursor: wait; }
    .export-status {
      max-width: 220px;
      overflow: hidden;
      color: var(--text-color-muted, #656d76);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .export-status.error { color: var(--true-color-red, #cf222e); }
    .environment-control {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-color-muted, #656d76);
      font-size: 12px;
      white-space: nowrap;
    }
    .environment-control[hidden] { display: none; }
    .environment-control select {
      padding: 6px 8px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 7px;
      background: var(--background-color-default, #fff);
      color: var(--text-color-default, #1f2328);
    }
    .snapshot {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 7px 16px;
      border-bottom: 1px solid var(--border-color-default, #d0d7de);
      overflow-x: auto;
      background: color-mix(in srgb, var(--surface) 92%, var(--color-focus-outline, #0969da));
      color: var(--text-color-muted, #656d76);
      font-size: 11px;
      white-space: nowrap;
    }
    .snapshot strong { color: var(--text-color-default, #1f2328); }
    .overview {
      display: flex;
      align-items: center;
      gap: 18px;
      min-height: 51px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-color-default, #d0d7de);
      overflow-x: auto;
      background: var(--surface);
    }
    .metric { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
    .metric strong { font-size: 17px; }
    .metric span, .timestamp { color: var(--text-color-muted, #656d76); font-size: 12px; }
    .filters { display: flex; gap: 6px; margin-left: auto; }
    .filter { padding: 3px 8px; white-space: nowrap; font-size: 12px; }
    .filter.off { opacity: .42; text-decoration: line-through; }
    main { display: grid; grid-template-columns: 240px minmax(0, 1fr) 330px; min-height: 0; }
    .application-panel {
      min-width: 0;
      overflow: auto;
      border-right: 1px solid var(--border-color-default, #d0d7de);
      background: var(--panel);
      padding: 12px;
    }
    .application-panel h2 {
      margin: 0;
      font-size: 15px;
      line-height: 21px;
    }
    .application-panel-summary {
      margin: 2px 0 10px;
      color: var(--text-color-muted, #656d76);
      font-size: 11px;
    }
    .application-group {
      margin: 14px 0 6px;
      color: var(--text-color-muted, #656d76);
      font-size: 10px;
      font-weight: var(--font-weight-semibold, 600);
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .application-list { display: grid; gap: 4px; }
    .application-button {
      width: 100%;
      padding: 7px 8px;
      border-color: transparent;
      background: transparent;
      text-align: left;
    }
    .application-button:hover {
      border-color: var(--border-color-default, #d0d7de);
      background: var(--surface);
    }
    .application-button.active {
      border-color: var(--color-focus-outline, #0969da);
      background: color-mix(in srgb, var(--color-focus-outline, #0969da) 13%, var(--surface));
    }
    .application-button strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }
    .application-button span {
      display: block;
      overflow: hidden;
      color: var(--text-color-muted, #656d76);
      font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace);
      font-size: 9px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .application-button.archived strong { color: var(--text-color-muted, #656d76); }
    .map-shell { position: relative; overflow: hidden; background: var(--background-color-default, #fff); }
    #graph { width: 100%; height: 100%; display: block; user-select: none; touch-action: none; }
    .map-controls {
      position: absolute;
      left: 12px;
      bottom: 12px;
      display: flex;
      gap: 5px;
      padding: 5px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 9px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .map-controls button { width: 32px; height: 29px; }
    .hint {
      position: absolute;
      right: 12px;
      bottom: 12px;
      color: var(--text-color-muted, #656d76);
      font-size: 11px;
      pointer-events: none;
    }
    aside {
      overflow: auto;
      border-left: 1px solid var(--border-color-default, #d0d7de);
      background: var(--panel);
      padding: 16px;
    }
    aside h2 { margin: 0 0 3px; font-size: 18px; line-height: 24px; }
    aside h3 {
      margin: 20px 0 8px;
      font-size: 12px;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: var(--text-color-muted, #656d76);
    }
    .kind { color: var(--text-color-muted, #656d76); margin-bottom: 12px; }
    .path, code {
      font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace);
      font-size: var(--text-code-inline, 12px);
    }
    .path {
      display: block;
      padding: 7px 8px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--background-color-default, #fff) 84%, var(--text-color-default, #1f2328));
      overflow-wrap: anywhere;
    }
    .tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .tag {
      padding: 2px 7px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 999px;
      font-size: 11px;
      background: var(--background-color-default, #fff);
    }
    .relation {
      width: 100%;
      padding: 8px 0;
      border: 0;
      border-bottom: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 0;
      background: transparent;
      text-align: left;
    }
    .relation:last-child { border-bottom: 0; }
    .relation strong { display: block; font-size: 12px; }
    .relation span { color: var(--text-color-muted, #656d76); font-size: 11px; }
    .file-list { margin: 0; padding-left: 18px; }
    .file-list li { margin: 4px 0; overflow-wrap: anywhere; }
    .resource-list { display: grid; gap: 7px; }
    .resource-item {
      padding: 8px 10px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 7px;
      background: var(--background-color-default, #fff);
    }
    .resource-item strong {
      display: block;
      overflow-wrap: anywhere;
      font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace);
      font-size: var(--text-code-inline, 12px);
    }
    .resource-item span { color: var(--text-color-muted, #656d76); font-size: 11px; }
    .empty { color: var(--text-color-muted, #656d76); }
    .summary-card {
      padding: 12px;
      margin-top: 12px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 9px;
      background: var(--background-color-default, #fff);
    }
    .summary-card strong { display: block; font-size: 22px; line-height: 28px; }
    .summary-card span { color: var(--text-color-muted, #656d76); }
    .category-title {
      font-family: var(--font-sans, sans-serif);
      font-weight: var(--font-weight-semibold, 600);
      font-size: 16px;
      fill: var(--text-color-default, #1f2328);
      text-transform: capitalize;
    }
    .category-count {
      font-family: var(--font-sans, sans-serif);
      font-size: 11px;
      fill: var(--text-color-muted, #656d76);
    }
    .edge {
      fill: none;
      stroke: var(--border-color-default, #8c959f);
      stroke-width: 1.25;
      opacity: .32;
      marker-end: url(#arrow);
      transition: opacity .15s, stroke-width .15s;
    }
    .edge.active { opacity: .92; stroke-width: 2.2; stroke: var(--color-focus-outline, #0969da); }
    .edge.dim { opacity: .05; }
    .node { cursor: pointer; transition: opacity .15s; }
    .node rect {
      fill: var(--panel);
      stroke: var(--border-color-default, #8c959f);
      stroke-width: 1.2;
      rx: 8;
      filter: drop-shadow(0 2px 3px color-mix(in srgb, var(--text-color-default, #1f2328) 9%, transparent));
    }
    .node .accent { stroke-width: 5; }
    .node.selected rect { stroke: var(--color-focus-outline, #0969da); stroke-width: 2.5; }
    .node.related rect { stroke: var(--color-focus-outline, #0969da); stroke-width: 2; }
    .node.application-root rect { stroke: var(--color-focus-outline, #0969da); stroke-width: 3; }
    .node.dim { opacity: .18; }
    .node text {
      pointer-events: none;
      font-family: var(--font-sans, sans-serif);
      fill: var(--text-color-default, #1f2328);
    }
    .node .name { font-size: 12px; font-weight: var(--font-weight-semibold, 600); }
    .node .type { font-size: 10px; fill: var(--text-color-muted, #656d76); }
    .node.archived rect {
      fill: color-mix(in srgb, var(--panel) 78%, var(--text-color-muted, #656d76));
      stroke-dasharray: 5 3;
    }
    .node.archived .name {
      fill: color-mix(in srgb, var(--text-color-default, #1f2328) 35%, var(--text-color-muted, #656d76));
    }
    .frontend .accent { stroke: var(--true-color-blue, #0969da); }
    .backend .accent { stroke: var(--true-color-red, #cf222e); }
    .platform .accent { stroke: #8250df; }
    .data .accent { stroke: #1a7f37; }
    .infrastructure .accent { stroke: #bf8700; }
    .external .accent { stroke: #9a6700; }
    .delivery .accent { stroke: #57606a; }
    .library .accent { stroke: #0550ae; }
    .quality .accent { stroke: #a40e26; }
    .documentation .accent { stroke: #6e7781; }
    @media (max-width: 900px) {
      main { grid-template-columns: 210px minmax(0, 1fr); grid-template-rows: minmax(480px, 1fr) auto; }
      aside {
        grid-column: 1 / -1;
        max-height: 320px;
        border-top: 1px solid var(--border-color-default, #d0d7de);
        border-left: 0;
      }
      .subtitle, .timestamp { display: none; }
    }
    @media (max-width: 680px) {
      html, body { min-height: 100%; height: auto; overflow: auto; }
      .app { min-height: 100vh; height: auto; grid-template-rows: auto auto auto auto; }
      header { flex-wrap: wrap; gap: 8px; }
      .search { order: 4; width: 100%; margin-left: 0; }
      .overview { gap: 12px; }
      .filters { margin-left: 0; }
      main { grid-template-columns: 1fr; grid-template-rows: auto minmax(480px, 68vh) auto; }
      .application-panel {
        max-height: 260px;
        border-right: 0;
        border-bottom: 1px solid var(--border-color-default, #d0d7de);
      }
      aside {
        grid-column: auto;
        max-height: none;
        border-top: 1px solid var(--border-color-default, #d0d7de);
        border-left: 0;
      }
      .hint { display: none; }
    }
  </style>
</head>
<body data-mode="${mode}">
  <div class="app">
    <header>
      <h1>Repository architecture</h1>
      <span class="subtitle" id="workspace">Discovering repository...</span>
      <input class="search" id="search" type="search" placeholder="Search components, paths, or technology" aria-label="Search architecture" />
      <button class="toolbar-button" id="view-toggle" aria-pressed="false">Show resources</button>
      <label class="environment-control" id="environment-control" hidden>
        Environment
        <select id="environment-select" aria-label="Resource environment">
          <option value="Development">Dev</option>
          <option value="UAT">UAT</option>
          <option value="Production" selected>Prod</option>
        </select>
      </label>
      ${archiveMarkup}
      <button class="toolbar-button" id="export-png" type="button">Export PNG</button>
      <span class="export-status" id="export-status" role="status" aria-live="polite"></span>
      ${refreshMarkup}
    </header>
    ${snapshotMarkup}
    <section class="overview">
      <div class="metric"><strong id="component-count">-</strong><span id="component-label">components</span></div>
      <div class="metric"><strong id="system-count">-</strong><span>systems</span></div>
      <div class="metric"><strong id="edge-count">-</strong><span>relationships</span></div>
      <span class="timestamp" id="timestamp"></span>
      <div class="filters" id="filters"></div>
    </section>
    <main>
      <nav class="application-panel" aria-label="Repository applications">
        <h2>Applications</h2>
        <p class="application-panel-summary" id="application-summary">Discovering applications…</p>
        <div class="application-list" id="application-list"></div>
      </nav>
      <section class="map-shell">
        <svg id="graph" role="img" aria-label="Repository application and dependency map"></svg>
        <div class="map-controls">
          <button id="zoom-in" title="Zoom in">+</button>
          <button id="zoom-out" title="Zoom out">−</button>
          <button id="fit" title="Fit map">⌂</button>
        </div>
        <span class="hint">Scroll to zoom · drag to pan · select a component for evidence</span>
      </section>
      <aside id="details"></aside>
    </main>
  </div>
  ${embeddedDatasets}
  <script>
    (function () {
      var NS = 'http://www.w3.org/2000/svg';
      var sourceGraph = null;
      var graph = null;
      var viewMode = 'services';
      var selectedEnvironment = 'Production';
      var selectedId = null;
      var selectedApplicationId = null;
      var activeCategories = new Set();
      var positions = new Map();
      var view = { x: 0, y: 0, width: 1600, height: 1000 };
      var naturalView = { x: 0, y: 0, width: 1600, height: 1000 };
      var svg = document.getElementById('graph');
      var details = document.getElementById('details');
      var applicationList = document.getElementById('application-list');
      var applicationSummary = document.getElementById('application-summary');
      var search = document.getElementById('search');
      var archiveButton = document.getElementById('archive-toggle');
      var viewButton = document.getElementById('view-toggle');
      var environmentControl = document.getElementById('environment-control');
      var environmentSelect = document.getElementById('environment-select');
      var exportButton = document.getElementById('export-png');
      var exportStatus = document.getElementById('export-status');
      var refreshButton = document.getElementById('refresh');
      var runtimeMode = '${mode}';
      var categoryOrder = ['frontend', 'backend', 'library', 'platform', 'data', 'infrastructure', 'delivery', 'external', 'quality', 'documentation'];

      function el(name, attrs, text) {
        var node = document.createElement(name);
        Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        if (text !== undefined) node.textContent = text;
        return node;
      }

      function svgEl(name, attrs, text) {
        var node = document.createElementNS(NS, name);
        Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        if (text !== undefined) node.textContent = text;
        return node;
      }

      function setViewBox() {
        svg.setAttribute('viewBox', [view.x, view.y, view.width, view.height].join(' '));
      }

      function fitMap() {
        view = Object.assign({}, naturalView);
        setViewBox();
      }

      function zoom(factor, centerX, centerY) {
        var cx = centerX === undefined ? view.x + view.width / 2 : centerX;
        var cy = centerY === undefined ? view.y + view.height / 2 : centerY;
        var nextWidth = Math.max(350, Math.min(naturalView.width * 2, view.width * factor));
        var nextHeight = nextWidth * (view.height / view.width);
        view.x = cx - (cx - view.x) * (nextWidth / view.width);
        view.y = cy - (cy - view.y) * (nextHeight / view.height);
        view.width = nextWidth;
        view.height = nextHeight;
        setViewBox();
      }

      function categoryLabel(category) {
        return category.replace(/-/g, ' ');
      }

      function applicationNodes() {
        if (!sourceGraph) return [];
        return sourceGraph.nodes
          .filter(function (node) {
            return !node.virtual &&
              (node.category === 'frontend' ||
                node.category === 'backend' ||
                node.id === 'component:strapi-cms/strapi');
          })
          .sort(function (left, right) {
            return (left.category + ':' + left.displayName + ':' + left.id)
              .localeCompare(right.category + ':' + right.displayName + ':' + right.id);
          });
      }

      function renderApplications() {
        applicationList.replaceChildren();
        var applications = applicationNodes();
        applicationSummary.textContent = applications.length + ' applications · select one to highlight its architecture';

        var allButton = el('button', {
          class: 'application-button' + (selectedApplicationId ? '' : ' active'),
          type: 'button',
          'aria-pressed': String(!selectedApplicationId)
        });
        allButton.appendChild(el('strong', {}, 'All applications'));
        allButton.appendChild(el('span', {}, 'Clear application focus'));
        allButton.addEventListener('click', function () { selectApplication(null); });
        applicationList.appendChild(allButton);

        var currentGroup;
        applications.forEach(function (application) {
          var group = application.category === 'platform' ? 'platform' : application.category;
          if (group !== currentGroup) {
            applicationList.appendChild(el('div', { class: 'application-group' }, categoryLabel(group)));
            currentGroup = group;
          }
          var button = el('button', {
            class: 'application-button' +
              (selectedApplicationId === application.id ? ' active' : '') +
              (application.archived ? ' archived' : ''),
            type: 'button',
            'aria-pressed': String(selectedApplicationId === application.id),
            'data-application-id': application.id,
            title: application.path || application.displayName
          });
          button.appendChild(el('strong', {}, application.displayName));
          button.appendChild(el('span', {}, application.path || application.kind));
          button.addEventListener('click', function () { selectApplication(application.id); });
          applicationList.appendChild(button);
        });
      }

      function applicationHighlight(visibleEdges) {
        if (!selectedApplicationId) return null;
        var nodeIds = new Set();
        var edgeIds = new Set();

        if (viewMode === 'resources') {
          graph.nodes.forEach(function (node) {
            if ((node.ownerIds || []).includes(selectedApplicationId)) nodeIds.add(node.id);
          });
          visibleEdges.forEach(function (edge) {
            if ((edge.ownerIds || []).includes(selectedApplicationId)) {
              edgeIds.add(edge.id);
              nodeIds.add(edge.source);
              nodeIds.add(edge.target);
            }
          });
        } else {
          nodeIds.add(selectedApplicationId);
          visibleEdges.forEach(function (edge) {
            if (edge.source === selectedApplicationId || edge.target === selectedApplicationId) {
              edgeIds.add(edge.id);
              nodeIds.add(edge.source);
              nodeIds.add(edge.target);
            }
          });
        }
        return { nodeIds: nodeIds, edgeIds: edgeIds };
      }

      function canonicalResourceType(type) {
        if (type === 'Referenced Container App' || type === 'Connected Container App') {
          return 'Container App';
        }
        return type;
      }

      function resourceId(environment, type, name) {
        return 'resource-instance:' + environment + ':' + type + ':' + name.toLowerCase();
      }

      function resourceCategory(type, ownerCategory, primary) {
        if (primary && (ownerCategory === 'frontend' || ownerCategory === 'backend')) {
          return ownerCategory;
        }
        if (/Storage|Redis|SQL|Database|Databricks/i.test(type)) return 'data';
        if (/External|Referenced/i.test(type)) return 'external';
        if (/Container App|Web App|Function App|Logic App/i.test(type)) return 'infrastructure';
        return 'platform';
      }

      function resourceRelation(type, referenced) {
        if (referenced) return 'calls';
        if (/Application Insights|Log Analytics/i.test(type)) return 'emits telemetry';
        if (/Key Vault/i.test(type)) return 'reads secrets';
        if (/App Configuration/i.test(type)) return 'reads configuration';
        if (/Service Bus/i.test(type)) return 'publishes / consumes';
        if (/Storage/i.test(type)) return 'stores / reads data';
        if (/Redis/i.test(type)) return 'caches data';
        if (/Managed Identity/i.test(type)) return 'uses identity';
        if (/Container Apps Environment/i.test(type)) return 'runs in';
        return 'uses';
      }

      function buildResourceGraph(baseGraph, environment) {
        var nodes = new Map();
        var edges = new Map();
        var primaryByOwner = new Map();
        var resourcesByOwner = new Map();
        var mappedByBaseNode = new Map();
        var baseNodes = new Map(baseGraph.nodes.map(function (node) { return [node.id, node]; }));
        var primaryTypes = new Set(['Container App', 'Web App', 'Function App', 'Static Web App']);
        var genericResourceTypes = {
          'resource:application-insights': ['Application Insights'],
          'resource:azure-app-configuration': ['App Configuration'],
          'resource:azure-key-vault': ['Key Vault'],
          'resource:azure-service-bus': ['Service Bus Namespace', 'Service Bus Topic', 'Service Bus Queue'],
          'resource:redis': ['Azure Cache for Redis'],
          'resource:azure-blob-storage': ['Storage Account', 'Blob Storage Container'],
          'resource:azure-api-management': ['API Management'],
          'resource:databricks': ['Azure Databricks']
        };
        baseGraph.nodes.forEach(function (node) {
          if (!node.virtual || !node.id.startsWith('resource:')) return;
          var types = (node.azureResources || []).map(function (resource) { return resource.type; });
          if (types.length) genericResourceTypes[node.id] = [...new Set(types)];
        });

        function mergeEvidence(target, values) {
          (values || []).forEach(function (value) {
            if (!target.includes(value)) target.push(value);
          });
          target.sort();
        }

        function ensureResource(resource, owner, primary, resourceGroups) {
          var type = canonicalResourceType(resource.type);
          var id = resourceId(environment, type, resource.name);
          var node = nodes.get(id);
          if (!node) {
            node = {
              id: id,
              name: resource.name,
              displayName: resource.name,
              description: type,
              category: resourceCategory(type, owner.category, primary),
              kind: type,
              technologies: [],
              manifests: [],
              pipelines: [],
              endpoints: [],
              azureResources: [{ type: type, name: resource.name, environment: environment, evidence: [] }],
              evidence: [],
              ownerServices: [],
              ownerIds: [],
              resourceGroups: [],
              environment: environment,
              resourceView: true,
              primary: Boolean(primary),
              archived: Boolean(owner.archived)
            };
            nodes.set(id, node);
          }
          if (primary) {
            node.primary = true;
            node.category = resourceCategory(type, owner.category, true);
          }
          if (!node.ownerServices.includes(owner.displayName)) node.ownerServices.push(owner.displayName);
          node.ownerServices.sort();
          if (!node.ownerIds.includes(owner.id)) node.ownerIds.push(owner.id);
          node.ownerIds.sort();
          mergeEvidence(node.resourceGroups, resourceGroups);
          node.archived = node.archived && Boolean(owner.archived);
          mergeEvidence(node.evidence, resource.evidence);
          mergeEvidence(node.azureResources[0].evidence, resource.evidence);
          return id;
        }

        function ensureExternal(baseNode) {
          var id = 'external-instance:' + baseNode.id;
          if (!nodes.has(id)) {
            nodes.set(id, {
              id: id,
              name: baseNode.name,
              displayName: baseNode.displayName,
              description: baseNode.description,
              category: 'external',
              kind: baseNode.kind,
              technologies: [],
              manifests: [],
              pipelines: [],
              endpoints: baseNode.endpoints || [],
              azureResources: [],
              evidence: (baseNode.endpoints || []).map(function (endpoint) { return endpoint.evidence; }).sort(),
              ownerServices: [],
              ownerIds: [],
              resourceGroups: [],
              environment: environment,
              resourceView: true,
              virtual: true
            });
          }
          mappedByBaseNode.set(baseNode.id, [id]);
        }

        function addResourceEdge(source, target, relation, evidence, confidence, ownerIds) {
          if (!source || !target || source === target) return;
          var key = source + '|' + target + '|' + relation;
          var edge = edges.get(key);
          if (!edge) {
            edge = {
              source: source,
              target: target,
              relation: relation,
              confidence: confidence || 'detected',
              evidence: [],
              ownerIds: []
            };
            edges.set(key, edge);
          }
          mergeEvidence(edge.evidence, evidence);
          mergeEvidence(edge.ownerIds, ownerIds);
        }

        baseGraph.nodes.forEach(function (owner) {
          if (owner.category === 'external') {
            if (owner.kind === 'External API') ensureExternal(owner);
            return;
          }
          var environmentResources = (owner.azureResources || [])
            .filter(function (resource) { return resource.environment === environment; });
          var resourceGroups = environmentResources
            .filter(function (resource) { return resource.type === 'Resource Group'; })
            .map(function (resource) { return resource.name; });
          var ownedResources = [];
          environmentResources
            .filter(function (resource) {
              return resource.type !== 'Resource Group' && resource.type !== 'Referenced Resource Group';
            })
            .forEach(function (resource) {
              var referenced = resource.type === 'Referenced Container App' || resource.type === 'Connected Container App';
              var primary = primaryTypes.has(resource.type);
              var ownsResource = primary ||
                (owner.category === 'infrastructure' &&
                  resource.type !== 'External endpoint' &&
                  !referenced);
              var id = ensureResource(
                resource,
                owner,
                primary,
                ownsResource ? resourceGroups : []
              );
              ownedResources.push({ id: id, resource: resource, primary: primary, referenced: referenced });
            });
          resourcesByOwner.set(owner.id, ownedResources);
          var primaryIds = ownedResources.filter(function (item) { return item.primary; }).map(function (item) { return item.id; });
          primaryByOwner.set(owner.id, primaryIds);
          if (owner.virtual) {
            mappedByBaseNode.set(owner.id, ownedResources.map(function (item) { return item.id; }));
          } else {
            mappedByBaseNode.set(owner.id, primaryIds);
          }
          primaryIds.forEach(function (primaryId) {
            ownedResources
              .filter(function (item) { return !item.primary; })
              .forEach(function (item) {
                addResourceEdge(
                  primaryId,
                  item.id,
                  resourceRelation(item.resource.type, item.referenced),
                  item.resource.evidence,
                  'detected',
                  [owner.id]
                );
              });
          });
          var containerAppIds = ownedResources
            .filter(function (item) {
              return canonicalResourceType(item.resource.type) === 'Container App';
            })
            .map(function (item) { return item.id; });
          var containerEnvironmentItems = ownedResources.filter(function (item) {
            return item.resource.type === 'Container Apps Environment';
          });
          containerAppIds.forEach(function (containerAppId) {
            containerEnvironmentItems.forEach(function (environmentItem) {
              addResourceEdge(
                containerAppId,
                environmentItem.id,
                'runs in',
                environmentItem.resource.evidence,
                'detected',
                [owner.id]
              );
            });
          });
        });

        var containerEnvironmentIds = [...nodes.values()]
          .filter(function (node) { return node.kind === 'Container Apps Environment'; })
          .map(function (node) { return node.id; });
        if (containerEnvironmentIds.length === 1) {
          [...nodes.values()]
            .filter(function (node) { return node.kind === 'Container App'; })
            .forEach(function (containerApp) {
              var hasEnvironment = [...edges.values()].some(function (edge) {
                return edge.source === containerApp.id &&
                  edge.relation === 'runs in' &&
                  containerEnvironmentIds.includes(edge.target);
              });
              if (!hasEnvironment) {
                var environmentNode = nodes.get(containerEnvironmentIds[0]);
                addResourceEdge(
                  containerApp.id,
                  environmentNode.id,
                  'runs in',
                  environmentNode.evidence,
                  'inferred',
                  containerApp.ownerIds
                );
              }
            });
        }

        baseGraph.edges.forEach(function (edge) {
          var sourceIds = primaryByOwner.get(edge.source) || mappedByBaseNode.get(edge.source) || [];
          if (!sourceIds.length) return;
          var targetNode = baseNodes.get(edge.target);
          var targetIds = mappedByBaseNode.get(edge.target) || [];
          if (genericResourceTypes[edge.target]) {
            var allowedTypes = genericResourceTypes[edge.target];
            targetIds = (resourcesByOwner.get(edge.source) || [])
              .filter(function (item) { return allowedTypes.includes(canonicalResourceType(item.resource.type)); })
              .map(function (item) { return item.id; });
          } else if (targetNode && !targetNode.virtual) {
            targetIds = primaryByOwner.get(edge.target) || [];
          }
          sourceIds.forEach(function (sourceId) {
            targetIds.forEach(function (targetId) {
              addResourceEdge(
                sourceId,
                targetId,
                edge.relation,
                edge.evidence,
                edge.confidence,
                [edge.source]
              );
            });
          });
        });

        var resourceNodes = [...nodes.values()].sort(function (left, right) {
          return (left.category + ':' + left.displayName).localeCompare(right.category + ':' + right.displayName);
        });
        var resourceEdges = [...edges.values()]
          .sort(function (left, right) {
            return (left.source + ':' + left.target + ':' + left.relation).localeCompare(right.source + ':' + right.target + ':' + right.relation);
          })
          .map(function (edge, index) { return Object.assign({ id: 'resource-edge:' + (index + 1) }, edge); });
        var categories = {};
        resourceNodes.forEach(function (node) { categories[node.category] = (categories[node.category] || 0) + 1; });

        return {
          schemaVersion: baseGraph.schemaVersion,
          generatedAt: baseGraph.generatedAt,
          durationMs: baseGraph.durationMs,
          workspaceName: baseGraph.workspaceName,
          options: baseGraph.options,
          summary: {
            components: resourceNodes.length,
            systems: resourceNodes.length,
            relationships: resourceEdges.length,
            categories: Object.fromEntries(Object.entries(categories).sort())
          },
          nodes: resourceNodes,
          edges: resourceEdges,
          resourceView: true,
          environment: environment
        };
      }

      function visibleNodes() {
        return graph.nodes.filter(function (node) { return activeCategories.has(node.category); });
      }

      function computeLayout(nodes) {
        var computedPositions = new Map();
        var nodeWidth = viewMode === 'resources' ? 240 : 190;
        var nodeHeight = viewMode === 'resources' ? 62 : 54;
        var columnWidth = nodeWidth + 55;
        var rowHeight = nodeHeight + 18;
        var groups = {};
        nodes.forEach(function (node) { (groups[node.category] || (groups[node.category] = [])).push(node); });
        var categories = categoryOrder.filter(function (category) { return groups[category]; });
        Object.keys(groups).forEach(function (category) {
          if (categories.indexOf(category) < 0) categories.push(category);
        });
        var maxRows = 1;
        categories.forEach(function (category, column) {
          groups[category].sort(function (a, b) { return a.displayName.localeCompare(b.displayName); });
          maxRows = Math.max(maxRows, groups[category].length);
          groups[category].forEach(function (node, row) {
            computedPositions.set(node.id, { x: 42 + column * columnWidth, y: 78 + row * rowHeight });
          });
        });
        var bounds = {
          x: 0,
          y: 0,
          width: Math.max(760, categories.length * columnWidth + 20),
          height: Math.max(520, maxRows * rowHeight + 55)
        };
        return {
          groups: groups,
          categories: categories,
          nodeWidth: nodeWidth,
          nodeHeight: nodeHeight,
          columnWidth: columnWidth,
          positions: computedPositions,
          bounds: bounds
        };
      }

      function layout(nodes) {
        var result = computeLayout(nodes);
        positions = result.positions;
        naturalView = result.bounds;
        return result;
      }

      function edgePath(source, target, nodeWidth, nodeHeight) {
        var sx = source.x + nodeWidth;
        var sy = source.y + nodeHeight / 2;
        var tx = target.x;
        var ty = target.y + nodeHeight / 2;
        if (target.x < source.x) {
          sx = source.x;
          tx = target.x + nodeWidth;
        }
        if (Math.abs(target.x - source.x) < 20) {
          sx = source.x + nodeWidth / 2;
          sy = source.y + nodeHeight;
          tx = target.x + nodeWidth / 2;
          ty = target.y;
        }
        var bend = Math.max(50, Math.abs(tx - sx) * 0.45);
        var direction = tx >= sx ? 1 : -1;
        return 'M ' + sx + ' ' + sy + ' C ' + (sx + bend * direction) + ' ' + sy + ', ' + (tx - bend * direction) + ' ' + ty + ', ' + tx + ' ' + ty;
      }

      function exportSelection() {
        var nodes = visibleNodes();
        var visibleNodeIds = new Set(nodes.map(function (node) { return node.id; }));
        var edges = graph.edges.filter(function (edge) {
          return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
        });
        var focus = applicationHighlight(edges);
        if (focus) {
          nodes = nodes.filter(function (node) { return focus.nodeIds.has(node.id); });
          var focusedNodeIds = new Set(nodes.map(function (node) { return node.id; }));
          edges = edges.filter(function (edge) {
            return focus.edgeIds.has(edge.id) &&
              focusedNodeIds.has(edge.source) &&
              focusedNodeIds.has(edge.target);
          });
        }
        if (!nodes.length) {
          throw new Error('The current view has no elements to export.');
        }
        return { nodes: nodes, edges: edges, focused: Boolean(focus) };
      }

      function resolveColor(value, fallback) {
        var probe = document.createElement('span');
        probe.style.color = value;
        probe.style.position = 'fixed';
        probe.style.visibility = 'hidden';
        document.body.appendChild(probe);
        var resolved = getComputedStyle(probe).color || fallback;
        probe.remove();
        return resolved;
      }

      function exportTheme() {
        var bodyStyle = getComputedStyle(document.body);
        var mapStyle = getComputedStyle(document.querySelector('.map-shell'));
        var panelStyle = getComputedStyle(document.querySelector('.application-panel'));
        var mutedStyle = getComputedStyle(applicationSummary);
        return {
          background: mapStyle.backgroundColor || bodyStyle.backgroundColor,
          panel: panelStyle.backgroundColor || bodyStyle.backgroundColor,
          border: panelStyle.borderRightColor || resolveColor('var(--border-color-default)', '#d0d7de'),
          text: bodyStyle.color,
          muted: mutedStyle.color,
          focus: resolveColor('var(--color-focus-outline)', '#0969da'),
          font: bodyStyle.fontFamily,
          category: {
            frontend: resolveColor('var(--true-color-blue)', '#0969da'),
            backend: resolveColor('var(--true-color-red)', '#cf222e'),
            platform: resolveColor('#8250df', '#8250df'),
            data: resolveColor('#1a7f37', '#1a7f37'),
            infrastructure: resolveColor('#bf8700', '#bf8700'),
            external: resolveColor('#9a6700', '#9a6700'),
            delivery: resolveColor('#57606a', '#57606a'),
            library: resolveColor('#0550ae', '#0550ae'),
            quality: resolveColor('#a40e26', '#a40e26'),
            documentation: resolveColor('#6e7781', '#6e7781')
          }
        };
      }

      function liveNodeFill(nodeId, fallback) {
        var group = [...svg.querySelectorAll('.node')].find(function (candidate) {
          return candidate.dataset.nodeId === nodeId;
        });
        var rect = group && group.querySelector('rect');
        return rect ? getComputedStyle(rect).fill : fallback;
      }

      function exportTitle() {
        var application = applicationNodes().find(function (candidate) {
          return candidate.id === selectedApplicationId;
        });
        return application
          ? application.displayName + ' architecture'
          : 'Repository architecture';
      }

      function exportSubtitle(selection) {
        var parts = [
          viewMode === 'resources'
            ? selectedEnvironment + ' Azure resources'
            : 'Service relationships'
        ];
        if (sourceGraph.options && sourceGraph.options.includeArchived) {
          parts.push('Archived applications included');
        }
        parts.push(selection.nodes.length + ' elements');
        parts.push(selection.edges.length + ' relationships');
        return parts.join(' · ');
      }

      function exportFilename() {
        var application = applicationNodes().find(function (candidate) {
          return candidate.id === selectedApplicationId;
        });
        var base = application ? application.displayName : 'repository-architecture';
        var context = viewMode === 'resources'
          ? selectedEnvironment + '-resources'
          : 'services';
        return (base + '-' + context)
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') + '.png';
      }

      function buildExportSvg() {
        var selection = exportSelection();
        var exportLayout = computeLayout(selection.nodes);
        var theme = exportTheme();
        var headerHeight = 82;
        var width = Math.ceil(exportLayout.bounds.width);
        var height = Math.ceil(exportLayout.bounds.height + headerHeight);
        var title = exportTitle();
        var subtitle = exportSubtitle(selection);
        var exportSvg = svgEl('svg', {
          xmlns: NS,
          width: String(width),
          height: String(height),
          viewBox: '0 0 ' + width + ' ' + height
        });
        exportSvg.appendChild(svgEl('rect', {
          x: '0',
          y: '0',
          width: String(width),
          height: String(height),
          fill: theme.background
        }));
        exportSvg.appendChild(svgEl('rect', {
          x: '0',
          y: '0',
          width: String(width),
          height: String(headerHeight),
          fill: theme.panel
        }));
        exportSvg.appendChild(svgEl('line', {
          x1: '0',
          y1: String(headerHeight - 1),
          x2: String(width),
          y2: String(headerHeight - 1),
          stroke: theme.border,
          'stroke-width': '1'
        }));
        exportSvg.appendChild(svgEl('text', {
          x: '30',
          y: '34',
          fill: theme.text,
          'font-family': theme.font,
          'font-size': '22',
          'font-weight': '600'
        }, title));
        exportSvg.appendChild(svgEl('text', {
          x: '30',
          y: '58',
          fill: theme.muted,
          'font-family': theme.font,
          'font-size': '12'
        }, subtitle));

        var defs = svgEl('defs');
        var edgeColor = selection.focused ? theme.focus : theme.border;
        var marker = svgEl('marker', {
          id: 'export-arrow',
          markerWidth: '8',
          markerHeight: '8',
          refX: '7',
          refY: '4',
          orient: 'auto',
          markerUnits: 'strokeWidth'
        });
        marker.appendChild(svgEl('path', {
          d: 'M0,0 L8,4 L0,8 z',
          fill: edgeColor
        }));
        defs.appendChild(marker);
        exportSvg.appendChild(defs);

        var graphGroup = svgEl('g', { transform: 'translate(0 ' + headerHeight + ')' });
        exportLayout.categories.forEach(function (category, index) {
          var categoryName = categoryLabel(category).replace(/\\b\\w/g, function (letter) {
            return letter.toUpperCase();
          });
          graphGroup.appendChild(svgEl('text', {
            x: String(42 + index * exportLayout.columnWidth),
            y: '31',
            fill: theme.text,
            'font-family': theme.font,
            'font-size': '16',
            'font-weight': '600'
          }, categoryName));
          graphGroup.appendChild(svgEl('text', {
            x: String(42 + index * exportLayout.columnWidth),
            y: '49',
            fill: theme.muted,
            'font-family': theme.font,
            'font-size': '11'
          }, exportLayout.groups[category].length +
            (viewMode === 'resources' ? ' resources' : ' systems')));
        });

        selection.edges.forEach(function (edge) {
          var source = exportLayout.positions.get(edge.source);
          var target = exportLayout.positions.get(edge.target);
          if (!source || !target) return;
          graphGroup.appendChild(svgEl('path', {
            d: edgePath(source, target, exportLayout.nodeWidth, exportLayout.nodeHeight),
            fill: 'none',
            stroke: edgeColor,
            'stroke-width': selection.focused ? '2.2' : '1.25',
            opacity: selection.focused ? '.92' : '.45',
            'marker-end': 'url(#export-arrow)'
          }));
        });

        selection.nodes.forEach(function (node) {
          var point = exportLayout.positions.get(node.id);
          var group = svgEl('g', {
            transform: 'translate(' + point.x + ' ' + point.y + ')'
          });
          group.appendChild(svgEl('rect', {
            width: String(exportLayout.nodeWidth),
            height: String(exportLayout.nodeHeight),
            rx: '8',
            fill: liveNodeFill(node.id, theme.panel),
            stroke: selection.focused ? theme.focus : theme.border,
            'stroke-width': selection.focused ? '2' : '1.2',
            'stroke-dasharray': node.archived ? '5 3' : 'none'
          }));
          group.appendChild(svgEl('line', {
            x1: '3',
            y1: '8',
            x2: '3',
            y2: String(exportLayout.nodeHeight - 8),
            stroke: theme.category[node.category] || theme.border,
            'stroke-width': '5'
          }));
          var label = node.displayName;
          var labelLines = viewMode === 'resources' && label.length > 32
            ? [label.slice(0, 32), label.slice(32)]
            : [viewMode === 'resources' ? label : (label.length > 27 ? label.slice(0, 26) + '…' : label)];
          var nameText = svgEl('text', {
            x: '14',
            y: labelLines.length > 1 ? '18' : '23',
            fill: node.archived ? theme.muted : theme.text,
            'font-family': theme.font,
            'font-size': '12',
            'font-weight': '600'
          });
          labelLines.forEach(function (line, index) {
            nameText.appendChild(svgEl('tspan', {
              x: '14',
              dy: index === 0 ? '0' : '14'
            }, line));
          });
          group.appendChild(nameText);
          var type = node.kind.length > 31 ? node.kind.slice(0, 30) + '…' : node.kind;
          group.appendChild(svgEl('text', {
            x: '14',
            y: String(exportLayout.nodeHeight - 10),
            fill: theme.muted,
            'font-family': theme.font,
            'font-size': '10'
          }, type));
          graphGroup.appendChild(group);
        });
        exportSvg.appendChild(graphGroup);

        return {
          svg: exportSvg,
          width: width,
          height: height,
          filename: exportFilename(),
          title: title,
          subtitle: subtitle,
          selection: selection
        };
      }

      function imageFromUrl(url) {
        return new Promise(function (resolve, reject) {
          var image = new Image();
          image.onload = function () { resolve(image); };
          image.onerror = function () { reject(new Error('The export diagram could not be rasterized.')); };
          image.src = url;
        });
      }

      function pngBlob(canvas) {
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('The browser could not create the PNG file.'));
          }, 'image/png');
        });
      }

      async function exportPng() {
        exportButton.disabled = true;
        exportButton.textContent = 'Exporting…';
        exportStatus.classList.remove('error');
        exportStatus.textContent = 'Preparing diagram…';
        var svgUrl;
        var pngUrl;
        try {
          var exported = buildExportSvg();
          var serialized = new XMLSerializer().serializeToString(exported.svg);
          var svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
          svgUrl = URL.createObjectURL(svgBlob);
          var image = await imageFromUrl(svgUrl);
          var maximumDimension = 8192;
          var scale = Math.min(
            2,
            maximumDimension / exported.width,
            maximumDimension / exported.height
          );
          if (!Number.isFinite(scale) || scale <= 0) {
            throw new Error('The export dimensions are invalid.');
          }
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(exported.width * scale));
          canvas.height = Math.max(1, Math.floor(exported.height * scale));
          var context = canvas.getContext('2d');
          if (!context) throw new Error('The browser does not support PNG canvas export.');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          var blob = await pngBlob(canvas);
          pngUrl = URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.href = pngUrl;
          link.download = exported.filename;
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          link.remove();
          exportButton.dataset.lastExportFilename = exported.filename;
          exportButton.dataset.lastExportTitle = exported.title;
          exportButton.dataset.lastExportSubtitle = exported.subtitle;
          exportButton.dataset.lastExportNodeIds = exported.selection.nodes
            .map(function (node) { return node.id; })
            .join(',');
          exportButton.dataset.lastExportEdgeCount = String(exported.selection.edges.length);
          exportStatus.textContent = 'Downloaded ' + exported.filename;
        } catch (error) {
          exportStatus.classList.add('error');
          exportStatus.textContent = 'Export failed: ' +
            (error instanceof Error ? error.message : String(error));
          console.error(error);
        } finally {
          if (svgUrl) URL.revokeObjectURL(svgUrl);
          if (pngUrl) setTimeout(function () { URL.revokeObjectURL(pngUrl); }, 1000);
          exportButton.disabled = false;
          exportButton.textContent = 'Export PNG';
        }
      }

      function renderGraph() {
        if (!graph) return;
        svg.replaceChildren();
        var nodes = visibleNodes();
        var nodeIds = new Set(nodes.map(function (node) { return node.id; }));
        var edges = graph.edges.filter(function (edge) { return nodeIds.has(edge.source) && nodeIds.has(edge.target); });
        var applicationFocus = applicationHighlight(edges);
        var result = layout(nodes);
        var defs = svgEl('defs');
        var marker = svgEl('marker', { id: 'arrow', markerWidth: '8', markerHeight: '8', refX: '7', refY: '4', orient: 'auto', markerUnits: 'strokeWidth' });
        marker.appendChild(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--border-color-default, #8c959f)' }));
        defs.appendChild(marker);
        var activeMarker = svgEl('marker', { id: 'arrow-active', markerWidth: '8', markerHeight: '8', refX: '7', refY: '4', orient: 'auto', markerUnits: 'strokeWidth' });
        activeMarker.appendChild(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--color-focus-outline, #0969da)' }));
        defs.appendChild(activeMarker);
        svg.appendChild(defs);

        result.categories.forEach(function (category, index) {
          svg.appendChild(svgEl('text', { x: 42 + index * result.columnWidth, y: 31, class: 'category-title' }, categoryLabel(category)));
          svg.appendChild(svgEl('text', { x: 42 + index * result.columnWidth, y: 49, class: 'category-count' }, result.groups[category].length + (viewMode === 'resources' ? ' resources' : ' systems')));
        });

        var edgeLayer = svgEl('g');
        edges.forEach(function (edge) {
          var source = positions.get(edge.source);
          var target = positions.get(edge.target);
          if (!source || !target) return;
          var selectedNodeEdge = selectedId && (edge.source === selectedId || edge.target === selectedId);
          var active = applicationFocus
            ? applicationFocus.edgeIds.has(edge.id)
            : selectedNodeEdge;
          var dim = Boolean(applicationFocus && !active);
          var pathNode = svgEl('path', {
            d: edgePath(source, target, result.nodeWidth, result.nodeHeight),
            class: 'edge' + (active ? ' active' : '') + (dim ? ' dim' : ''),
            'data-source': edge.source,
            'data-target': edge.target,
            'data-edge-id': edge.id,
            'data-owner-ids': (edge.ownerIds || []).join(',')
          });
          if (active) pathNode.setAttribute('marker-end', 'url(#arrow-active)');
          pathNode.appendChild(svgEl('title', {}, edge.relation));
          edgeLayer.appendChild(pathNode);
        });
        svg.appendChild(edgeLayer);

        var query = search.value.trim().toLowerCase();
        var neighbors = new Set();
        if (!applicationFocus && selectedId) {
          neighbors.add(selectedId);
          edges.forEach(function (edge) {
            if (edge.source === selectedId) neighbors.add(edge.target);
            if (edge.target === selectedId) neighbors.add(edge.source);
          });
        }
        nodes.forEach(function (node) {
          var point = positions.get(node.id);
          var haystack = [node.displayName, node.name, node.path, node.kind, node.description]
            .concat(node.technologies || [], node.ownerServices || [], node.evidence || [])
            .join(' ')
            .toLowerCase();
          var related = Boolean(applicationFocus && applicationFocus.nodeIds.has(node.id));
          var dim = (query && haystack.indexOf(query) < 0) ||
            (applicationFocus && !related) ||
            (!applicationFocus && selectedId && !neighbors.has(node.id));
          var group = svgEl('g', {
            class: 'node ' + node.category +
              (node.id === selectedId ? ' selected' : '') +
              (related ? ' related' : '') +
              (node.id === selectedApplicationId ? ' application-root' : '') +
              (dim ? ' dim' : '') +
              (node.archived ? ' archived' : ''),
            transform: 'translate(' + point.x + ' ' + point.y + ')',
            tabindex: '0',
            role: 'button',
            'aria-label': node.displayName + ', ' + node.kind,
            'data-node-id': node.id
          });
          group.appendChild(svgEl('rect', { width: String(result.nodeWidth), height: String(result.nodeHeight) }));
          group.appendChild(svgEl('line', { x1: '3', y1: '8', x2: '3', y2: String(result.nodeHeight - 8), class: 'accent' }));
          var label = node.displayName;
          var labelLines = viewMode === 'resources' && label.length > 32
            ? [label.slice(0, 32), label.slice(32)]
            : [viewMode === 'resources' ? label : (label.length > 27 ? label.slice(0, 26) + '…' : label)];
          var nameText = svgEl('text', { x: '14', y: labelLines.length > 1 ? '18' : '23', class: 'name' });
          labelLines.forEach(function (line, index) {
            nameText.appendChild(svgEl('tspan', { x: '14', dy: index === 0 ? '0' : '14' }, line));
          });
          group.appendChild(nameText);
          var type = node.kind.length > 31 ? node.kind.slice(0, 30) + '…' : node.kind;
          group.appendChild(svgEl('text', { x: '14', y: String(result.nodeHeight - 10), class: 'type' }, type));
          group.appendChild(svgEl('title', {}, node.displayName + '\\n' + node.kind));
          group.addEventListener('click', function (event) {
            event.stopPropagation();
            selectNode(node.id);
          });
          group.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') selectNode(node.id);
          });
          svg.appendChild(group);
        });
        setViewBox();
      }

      function appendTags(container, values) {
        var tags = el('div', { class: 'tags' });
        values.forEach(function (value) { tags.appendChild(el('span', { class: 'tag' }, value)); });
        container.appendChild(tags);
      }

      function appendFiles(container, title, files) {
        if (!files || !files.length) return;
        container.appendChild(el('h3', {}, title));
        var list = el('ul', { class: 'file-list path' });
        files.slice(0, 12).forEach(function (file) { list.appendChild(el('li', {}, file)); });
        container.appendChild(list);
      }

      function renderRelation(edge, direction, nodeById) {
        var targetId = direction === 'out' ? edge.target : edge.source;
        var target = nodeById.get(targetId);
        var button = el('button', { class: 'relation' });
        button.appendChild(el('strong', {}, (direction === 'out' ? '→ ' : '← ') + edge.relation));
        button.appendChild(el('span', {}, target ? target.displayName : targetId));
        if (edge.evidence && edge.evidence.length) button.title = edge.evidence.join('\\n');
        button.addEventListener('click', function () { selectNode(targetId); });
        return button;
      }

      function renderDetails() {
        details.replaceChildren();
        if (!graph) return;
        var node = graph.nodes.find(function (item) { return item.id === selectedId; });
        if (!node) {
          var focusedApplication = applicationNodes().find(function (application) {
            return application.id === selectedApplicationId;
          });
          if (focusedApplication) {
            var focus = applicationHighlight(graph.edges);
            details.appendChild(el('h2', {}, focusedApplication.displayName));
            details.appendChild(el('div', { class: 'kind' }, 'Application focus · ' + categoryLabel(focusedApplication.category)));
            if (focusedApplication.path) {
              details.appendChild(el('code', { class: 'path' }, focusedApplication.path));
            }
            var focusSummary = el('div', { class: 'summary-card' });
            focusSummary.appendChild(el('strong', {}, String(focus ? focus.nodeIds.size : 0)));
            focusSummary.appendChild(el('span', {}, viewMode === 'resources'
              ? selectedEnvironment + ' linked resources'
              : 'related architecture elements'));
            details.appendChild(focusSummary);
            details.appendChild(el('p', { class: 'empty' }, viewMode === 'resources'
              ? 'Highlighted boxes and arrows are attributable to this application in the selected environment.'
              : 'Highlighted boxes and arrows show this application’s direct repository relationships.'));
            return;
          }
          details.appendChild(el('h2', {}, 'Architecture overview'));
          details.appendChild(el('div', { class: 'kind' }, viewMode === 'resources'
            ? 'Select a resource to inspect its owners, evidence, and connections.'
            : 'Select a node to inspect its evidence and data flow.'));
          Object.keys(graph.summary.categories).sort().forEach(function (category) {
            var card = el('div', { class: 'summary-card' });
            card.appendChild(el('strong', {}, String(graph.summary.categories[category])));
            card.appendChild(el('span', {}, categoryLabel(category)));
            details.appendChild(card);
          });
          details.appendChild(el('h3', {}, 'How relationships are found'));
          details.appendChild(el('p', { class: 'empty' }, viewMode === 'resources'
            ? 'Environment-specific IaC names are linked through service relationships and each application’s declared resource dependencies. Only resources resolved for ' + selectedEnvironment + ' are shown.'
            : 'Package dependencies, sample environment variables, Docker Compose dependencies, endpoint hosts, GraphQL schemas, and Azure DevOps workflows. Values that may contain credentials are never exposed.'));
          return;
        }
        details.appendChild(el('h2', {}, node.displayName));
        details.appendChild(el('div', { class: 'kind' }, node.kind + (node.archived ? ' · Archived' : '')));
        if (node.resourceView) {
          details.appendChild(el('code', { class: 'path' }, node.environment));
          details.appendChild(el('h3', {}, 'Resource group'));
          if (node.resourceGroups && node.resourceGroups.length) {
            appendTags(details, node.resourceGroups);
          } else {
            details.appendChild(el('p', { class: 'empty' }, 'Not resolved from repository deployment configuration.'));
          }
          if (node.ownerServices && node.ownerServices.length) {
            details.appendChild(el('h3', {}, 'Referenced by services'));
            appendTags(details, node.ownerServices);
          }
          appendFiles(details, 'Resource evidence', node.evidence);
        }
        if (node.path) details.appendChild(el('code', { class: 'path' }, node.path));
        if (node.description && node.description !== node.kind) details.appendChild(el('p', {}, node.description));
        if (node.technologies && node.technologies.length) {
          details.appendChild(el('h3', {}, 'Technology'));
          appendTags(details, node.technologies);
        }
        var environmentResources = (node.azureResources || []).filter(function (resource) {
          return resource.environment === selectedEnvironment;
        });
        if (!node.resourceView && environmentResources.length) {
          details.appendChild(el('h3', {}, selectedEnvironment + ' Azure resources'));
          var resourceList = el('div', { class: 'resource-list' });
          environmentResources.forEach(function (resource) {
            var item = el('div', { class: 'resource-item' });
            item.appendChild(el('strong', {}, resource.name));
            item.appendChild(el('span', {}, resource.type));
            if (resource.evidence && resource.evidence.length) item.title = resource.evidence.join('\\n');
            resourceList.appendChild(item);
          });
          details.appendChild(resourceList);
        }
        var nodeById = new Map(graph.nodes.map(function (item) { return [item.id, item]; }));
        var outgoing = graph.edges.filter(function (edge) { return edge.source === node.id; });
        var incoming = graph.edges.filter(function (edge) { return edge.target === node.id; });
        if (outgoing.length) {
          details.appendChild(el('h3', {}, 'Outgoing data flow'));
          outgoing.forEach(function (edge) { details.appendChild(renderRelation(edge, 'out', nodeById)); });
        }
        if (incoming.length) {
          details.appendChild(el('h3', {}, 'Incoming dependencies'));
          incoming.forEach(function (edge) { details.appendChild(renderRelation(edge, 'in', nodeById)); });
        }
        if (node.endpoints && node.endpoints.length) {
          details.appendChild(el('h3', {}, 'Safe endpoints'));
          var endpointList = el('ul', { class: 'file-list' });
          node.endpoints.forEach(function (endpoint) {
            endpointList.appendChild(el('li', {}, endpoint.name + ': ' + endpoint.url));
          });
          details.appendChild(endpointList);
        }
        appendFiles(details, 'Manifests and schemas', node.manifests);
        appendFiles(details, 'Delivery workflows', node.pipelines);
        if (!outgoing.length && !incoming.length) {
          details.appendChild(el('p', { class: 'empty' }, 'No relationships were inferred for this component.'));
        }
      }

      function selectNode(id) {
        selectedId = selectedId === id ? null : id;
        renderGraph();
        renderDetails();
      }

      function selectApplication(id) {
        selectedApplicationId = selectedApplicationId === id ? null : id;
        selectedId = viewMode === 'services' ? selectedApplicationId : null;
        activeCategories.clear();
        graph.nodes.forEach(function (node) { activeCategories.add(node.category); });
        renderApplications();
        renderFilters();
        renderGraph();
        renderDetails();
        fitMap();
      }

      function renderFilters() {
        var container = document.getElementById('filters');
        container.replaceChildren();
        var categories = categoryOrder.filter(function (category) {
          return graph.nodes.some(function (node) { return node.category === category; });
        });
        categories.forEach(function (category) {
          var button = el('button', { class: 'filter' + (activeCategories.has(category) ? '' : ' off') }, categoryLabel(category));
          button.addEventListener('click', function () {
            if (activeCategories.has(category)) activeCategories.delete(category);
            else activeCategories.add(category);
            renderFilters();
            selectedId = null;
            renderGraph();
            renderDetails();
            fitMap();
          });
          container.appendChild(button);
        });
      }

      function rebuildGraph(resetCategories) {
        graph = viewMode === 'resources'
          ? buildResourceGraph(sourceGraph, selectedEnvironment)
          : sourceGraph;
        if (
          selectedApplicationId &&
          !applicationNodes().some(function (application) {
            return application.id === selectedApplicationId;
          })
        ) {
          selectedApplicationId = null;
        }
        if (archiveButton) {
          var archiveEnabled = Boolean(sourceGraph.options && sourceGraph.options.includeArchived);
          archiveButton.textContent = archiveEnabled
            ? (runtimeMode === 'standalone' ? 'Show current snapshot' : 'Hide archived')
            : (runtimeMode === 'standalone' ? 'Include archived snapshot' : 'Include archived');
          archiveButton.classList.toggle('active', archiveEnabled);
          archiveButton.setAttribute('aria-pressed', String(archiveEnabled));
        }
        viewButton.textContent = viewMode === 'resources' ? 'Show services' : 'Show resources';
        viewButton.classList.toggle('active', viewMode === 'resources');
        viewButton.setAttribute('aria-pressed', String(viewMode === 'resources'));
        environmentControl.hidden = viewMode !== 'resources';
        environmentSelect.value = selectedEnvironment;
        search.placeholder = viewMode === 'resources'
          ? 'Search resource names, types, or owners'
          : 'Search components, paths, or technology';
        if (resetCategories) activeCategories.clear();
        if (!activeCategories.size) graph.nodes.forEach(function (node) { activeCategories.add(node.category); });
        if (selectedId && !graph.nodes.some(function (node) { return node.id === selectedId; })) selectedId = null;
        document.getElementById('workspace').textContent = graph.workspaceName;
        document.getElementById('component-count').textContent = graph.summary.components;
        document.getElementById('component-label').textContent = viewMode === 'resources' ? 'resources' : 'components';
        document.getElementById('system-count').textContent = graph.summary.systems;
        document.getElementById('edge-count').textContent = graph.summary.relationships;
        document.getElementById('timestamp').textContent = 'Generated ' + new Date(graph.generatedAt).toLocaleString() + ' in ' + graph.durationMs + ' ms';
        renderApplications();
        renderFilters();
        renderGraph();
        renderDetails();
        fitMap();
      }

      function applyGraph(nextGraph, resetCategories) {
        sourceGraph = nextGraph;
        rebuildGraph(resetCategories);
      }

      ${runtimeAdapter}

      search.addEventListener('input', renderGraph);
      if (refreshButton) refreshButton.addEventListener('click', function () { refreshGraph(); });
      if (archiveButton) archiveButton.addEventListener('click', toggleArchived);
      exportButton.addEventListener('click', exportPng);
      viewButton.addEventListener('click', function () {
        viewMode = viewMode === 'services' ? 'resources' : 'services';
        selectedId = null;
        rebuildGraph(true);
      });
      environmentSelect.addEventListener('change', function () {
        selectedEnvironment = environmentSelect.value;
        selectedId = null;
        if (viewMode === 'resources') rebuildGraph(true);
        else renderDetails();
      });
      document.getElementById('zoom-in').addEventListener('click', function () { zoom(.8); });
      document.getElementById('zoom-out').addEventListener('click', function () { zoom(1.25); });
      document.getElementById('fit').addEventListener('click', fitMap);
      svg.addEventListener('click', function () { if (selectedId) selectNode(selectedId); });
      svg.addEventListener('wheel', function (event) {
        event.preventDefault();
        var point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        var transformed = point.matrixTransform(svg.getScreenCTM().inverse());
        zoom(event.deltaY > 0 ? 1.12 : .89, transformed.x, transformed.y);
      }, { passive: false });
      var drag = null;
      svg.addEventListener('pointerdown', function (event) {
        if (event.target === svg || event.target.tagName === 'path') {
          drag = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
          svg.setPointerCapture(event.pointerId);
        }
      });
      svg.addEventListener('pointermove', function (event) {
        if (!drag) return;
        view.x = drag.viewX - (event.clientX - drag.x) * view.width / svg.clientWidth;
        view.y = drag.viewY - (event.clientY - drag.y) * view.height / svg.clientHeight;
        setViewBox();
      });
      svg.addEventListener('pointerup', function () { drag = null; });
      startUpdates();
      loadGraph().catch(function (error) {
        details.replaceChildren(el('h2', {}, 'Architecture unavailable'), el('p', { class: 'empty' }, error.message));
      });
    })();
  </script>
</body>
</html>`;
}
