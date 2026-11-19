import type { ScanReport } from '../types.js';
import { escapeHtml, safeJsonEmbed } from '../utils.js';

export function renderHtmlReport(report: ScanReport): string {
  const safeTitle = escapeHtml(`Crossfire Radar — ${report.repoRoot}`);
  const safeToolVersion = escapeHtml(report.toolVersion);
  const safeRepoRoot = escapeHtml(report.repoRoot);
  const safeGeneratedAt = escapeHtml(report.generatedAt);
  const safeDurationMs = escapeHtml(String(report.durationMs));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    :root {
      --bg: #0a0e17;
      --card: #111827;
      --card-border: #1f2937;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --cyan: #06b6d4;
      --cyan-glow: rgba(6, 182, 212, 0.15);
      --red: #ef4444;
      --red-bg: rgba(239, 68, 68, 0.15);
      --amber: #f59e0b;
      --amber-bg: rgba(245, 158, 11, 0.15);
      --green: #10b981;
      --green-bg: rgba(16, 185, 129, 0.15);
      --blue: #3b82f6;
      --blue-bg: rgba(59, 130, 246, 0.15);
      --purple: #8b5cf6;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding: 24px;
      min-height: 100vh;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* Header */
    .header {
      background: linear-gradient(135deg, #111827 0%, #1a2234 100%);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .radar-icon {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: linear-gradient(135deg, #06b6d4, #3b82f6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 16px var(--cyan-glow);
    }

    .brand h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .version-tag {
      font-size: 11px;
      font-family: var(--font-mono);
      background: rgba(6, 182, 212, 0.2);
      color: var(--cyan);
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid rgba(6, 182, 212, 0.3);
    }

    .meta-details {
      display: flex;
      gap: 16px;
      font-size: 13px;
      color: var(--muted);
      flex-wrap: wrap;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .meta-item strong {
      color: var(--text);
      font-family: var(--font-mono);
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
    }

    .kpi-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
      overflow: hidden;
    }

    .kpi-card::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: var(--cyan);
      opacity: 0.8;
    }

    .kpi-card.alert::before { background: var(--red); }
    .kpi-card.warn::before { background: var(--amber); }
    .kpi-card.clean::before { background: var(--green); }

    .kpi-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
      font-weight: 600;
    }

    .kpi-value {
      font-size: 28px;
      font-weight: 800;
      font-family: var(--font-mono);
      color: var(--text);
    }

    .kpi-sub {
      font-size: 12px;
      color: var(--muted);
    }

    /* Card Panels */
    .panel {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 14px;
    }

    .panel-title {
      font-size: 16px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Heatmap Table */
    .heatmap-wrapper {
      overflow-x: auto;
      max-width: 100%;
    }

    .heatmap-table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--font-mono);
      font-size: 13px;
    }

    .heatmap-table th, .heatmap-table td {
      padding: 10px 14px;
      text-align: center;
      border: 1px solid var(--card-border);
    }

    .heatmap-table th {
      background: #1a2234;
      font-weight: 600;
      color: var(--muted);
      white-space: nowrap;
    }

    .heatmap-table th.row-header {
      text-align: left;
      font-weight: 600;
      color: var(--text);
      background: #111827;
    }

    .cell-self {
      background: rgba(255, 255, 255, 0.02);
      color: var(--muted);
    }

    .cell-clean {
      background: var(--green-bg);
      color: var(--green);
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }

    .cell-warn {
      background: var(--amber-bg);
      color: var(--amber);
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }

    .cell-conflict {
      background: var(--red-bg);
      color: var(--red);
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }

    .cell-clean:hover, .cell-warn:hover, .cell-conflict:hover {
      filter: brightness(1.3);
      transform: scale(1.02);
    }

    .cell-active {
      outline: 2px solid var(--cyan);
      box-shadow: 0 0 10px var(--cyan);
    }

    /* Pipeline Waves */
    .waves-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .wave-row {
      display: flex;
      align-items: center;
      gap: 16px;
      background: #172033;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px 18px;
      flex-wrap: wrap;
    }

    .wave-badge {
      background: var(--cyan);
      color: #000;
      font-weight: 700;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      white-space: nowrap;
    }

    .wave-units {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .unit-pill {
      background: #1f2937;
      border: 1px solid #374151;
      padding: 4px 10px;
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text);
    }

    .unit-pill.dirty {
      border-color: var(--amber);
      color: var(--amber);
    }

    .landing-sequence {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }

    .landing-item {
      display: flex;
      align-items: baseline;
      gap: 12px;
      font-size: 13px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 6px;
    }

    .landing-num {
      font-family: var(--font-mono);
      font-weight: 700;
      color: var(--cyan);
      width: 24px;
    }

    .landing-unit {
      font-family: var(--font-mono);
      font-weight: 600;
      color: var(--text);
    }

    .landing-rationale {
      color: var(--muted);
      flex: 1;
    }

    /* Filters Bar */
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: center;
      background: #172033;
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--card-border);
    }

    .search-input {
      background: #111827;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      flex: 1;
      min-width: 200px;
      outline: none;
    }

    .search-input:focus {
      border-color: var(--cyan);
      box-shadow: 0 0 0 2px var(--cyan-glow);
    }

    .pill-group {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-pill {
      background: #111827;
      border: 1px solid var(--card-border);
      color: var(--muted);
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }

    .filter-pill:hover {
      border-color: #374151;
      color: var(--text);
    }

    .filter-pill.active {
      background: var(--cyan);
      color: #000;
      border-color: var(--cyan);
    }

    .filter-pill.active .count-badge {
      background: rgba(0, 0, 0, 0.2);
      color: #000;
    }

    .count-badge {
      background: #1f2937;
      color: var(--muted);
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-family: var(--font-mono);
    }

    .pair-filter-banner {
      background: var(--cyan-glow);
      border: 1px solid var(--cyan);
      color: var(--cyan);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .clear-btn {
      background: transparent;
      border: 1px solid currentColor;
      color: inherit;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }

    /* Findings Cards */
    .findings-container {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .finding-card {
      background: #111827;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border-left: 4px solid var(--card-border);
    }

    .finding-card.severity-critical { border-left-color: var(--red); }
    .finding-card.severity-high { border-left-color: var(--red); }
    .finding-card.severity-medium { border-left-color: var(--amber); }
    .finding-card.severity-low { border-left-color: var(--blue); }

    .finding-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .badge-stack {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }

    .badge {
      font-size: 11px;
      font-weight: 700;
      font-family: var(--font-mono);
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .badge-critical { background: var(--red-bg); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-high { background: var(--red-bg); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-medium { background: var(--amber-bg); color: var(--amber); border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-low { background: var(--blue-bg); color: var(--blue); border: 1px solid rgba(59, 130, 246, 0.3); }
    .badge-layer { background: #1f2937; color: var(--cyan); border: 1px solid #374151; }
    .badge-rule { background: #172033; color: var(--text); border: 1px solid #374151; }

    .units-involved {
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--cyan);
      font-weight: 600;
    }

    .finding-files {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--muted);
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .file-tag {
      background: #1a2234;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid #283548;
    }

    .finding-summary {
      font-size: 14px;
      color: var(--text);
      font-weight: 500;
    }

    .evidence-block {
      background: #0a0e17;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: #cbd5e1;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .remediation-box {
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13px;
      color: #34d399;
      display: flex;
      gap: 8px;
    }

    .remediation-title {
      font-weight: 700;
      white-space: nowrap;
    }

    .empty-state {
      padding: 48px;
      text-align: center;
      color: var(--muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .empty-state-icon {
      font-size: 36px;
      color: var(--green);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <div class="brand">
        <div class="radar-icon">⚡</div>
        <div>
          <h1>CROSSFIRE RADAR <span class="version-tag">v${safeToolVersion}</span></h1>
          <div class="meta-details">
            <span class="meta-item">Repo: <strong>${safeRepoRoot}</strong></span>
            <span class="meta-item">Duration: <strong>${safeDurationMs}ms</strong></span>
            <span class="meta-item">Scan Time: <strong>${safeGeneratedAt}</strong></span>
          </div>
        </div>
      </div>
    </header>

    <!-- KPI Grid -->
    <section class="kpi-grid">
      <div class="kpi-card ${report.summary.dirtyUnits > 0 ? 'warn' : 'clean'}">
        <div class="kpi-label">Units Scanned</div>
        <div class="kpi-value">${report.summary.totalUnits}</div>
        <div class="kpi-sub">${report.summary.dirtyUnits} dirty worktree${report.summary.dirtyUnits === 1 ? '' : 's'}</div>
      </div>
      <div class="kpi-card ${report.summary.conflictingPairs > 0 ? 'alert' : 'clean'}">
        <div class="kpi-label">Conflicting Pairs</div>
        <div class="kpi-value">${report.summary.conflictingPairs} <span style="font-size: 16px; color: var(--muted);">/ ${report.summary.totalPairs}</span></div>
        <div class="kpi-sub">${report.summary.conflictingPairs === 0 ? 'All worktree pairs clean' : 'Collisions require resolution'}</div>
      </div>
      <div class="kpi-card ${report.summary.byLayer.semantic > 0 ? 'alert' : 'clean'}">
        <div class="kpi-label">Semantic & Contract Breaks</div>
        <div class="kpi-value">${report.summary.byLayer.semantic}</div>
        <div class="kpi-sub">${report.summary.bySeverity.critical} critical, ${report.summary.bySeverity.high} high</div>
      </div>
      <div class="kpi-card clean">
        <div class="kpi-label">Optimal Parallel Waves</div>
        <div class="kpi-value">${report.mergeOrder.parallelWaves.length}</div>
        <div class="kpi-sub">Conflict-free landing stages</div>
      </div>
    </section>

    <!-- N×N Collision Matrix -->
    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">N×N Worktree & Branch Collision Heatmap</div>
        <div style="font-size: 12px; color: var(--muted);">Click any cell to filter findings for that pair</div>
      </div>
      <div id="heatmap-mount" class="heatmap-wrapper"></div>
    </section>

    <!-- Pipeline Waves & Merge Order -->
    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">Merge Order & Parallel Wave Pipeline</div>
      </div>
      <div id="waves-mount" class="waves-container"></div>
      <div id="landing-mount" class="landing-sequence"></div>
    </section>

    <!-- Findings Section -->
    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <span>Collision Findings</span>
          <span id="findings-count-badge" class="count-badge" style="font-size: 12px;">0</span>
        </div>
      </div>

      <div id="pair-filter-banner" class="pair-filter-banner" style="display: none;">
        <span id="pair-filter-text"></span>
        <button id="clear-pair-filter-btn" class="clear-btn">Clear Pair Filter</button>
      </div>

      <div class="filter-bar">
        <input type="text" id="search-input" class="search-input" placeholder="Search rules, files, units, or summaries...">
        <div class="pill-group" id="severity-pills"></div>
        <div class="pill-group" id="layer-pills"></div>
      </div>

      <div id="findings-mount" class="findings-container"></div>
    </section>
  </div>

  <script id="crossfire-data" type="application/json">
${safeJsonEmbed(report)}
  </script>

  <script>
    // Safe DOM creation helper - ZERO innerHTML usage for untrusted content!
    function el(tag, attrs, children) {
      const node = document.createElement(tag);
      if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
          if (k === 'className') node.className = v;
          else if (k === 'textContent') node.textContent = v;
          else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
          } else if (v !== undefined && v !== null) {
            node.setAttribute(k, v);
          }
        }
      }
      if (children) {
        const list = Array.isArray(children) ? children : [children];
        for (const c of list) {
          if (c === null || c === undefined) continue;
          if (typeof c === 'string' || typeof c === 'number') {
            node.appendChild(document.createTextNode(String(c)));
          } else if (c instanceof Node) {
            node.appendChild(c);
          }
        }
      }
      return node;
    }

    (function() {
      const dataEl = document.getElementById('crossfire-data');
      if (!dataEl) return;
      const REPORT = JSON.parse(dataEl.textContent);

      // State
      let selectedSeverity = 'all';
      let selectedLayer = 'all';
      let searchQuery = '';
      let activePair = null; // [unitA, unitB] or null

      // Mount Heatmap
      const heatmapMount = document.getElementById('heatmap-mount');
      if (heatmapMount && REPORT.units.length >= 2) {
        const table = el('table', { className: 'heatmap-table' });
        const thead = el('thead');
        const headerRow = el('tr', {}, [el('th', { textContent: 'Unit' })]);

        REPORT.units.forEach((u, i) => {
          headerRow.appendChild(el('th', { textContent: '[' + (i + 1) + '] ' + u.id }));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = el('tbody');
        const pairMap = new Map();
        for (const p of REPORT.pairs) {
          pairMap.set(p.unitA + ':::' + p.unitB, p);
          pairMap.set(p.unitB + ':::' + p.unitA, p);
        }

        REPORT.units.forEach((uA, i) => {
          const row = el('tr');
          row.appendChild(el('th', { className: 'row-header', textContent: '[' + (i + 1) + '] ' + uA.id }));

          REPORT.units.forEach((uB, j) => {
            if (i === j) {
              row.appendChild(el('td', { className: 'cell-self', textContent: '·' }));
            } else {
              const pair = pairMap.get(uA.id + ':::' + uB.id);
              let statusClass = 'cell-clean';
              let text = '✓';

              if (pair) {
                if (pair.status === 'warn') {
                  statusClass = 'cell-warn';
                  text = '!W';
                } else if (pair.status === 'conflict') {
                  statusClass = 'cell-conflict';
                  text = '✗ ' + pair.score;
                }
              }

              const cell = el('td', {
                className: statusClass,
                textContent: text,
                title: 'Click to filter findings between ' + uA.id + ' and ' + uB.id,
                onClick: () => {
                  document.querySelectorAll('.heatmap-table td').forEach(c => c.classList.remove('cell-active'));
                  cell.classList.add('cell-active');
                  setPairFilter(uA.id, uB.id);
                }
              });
              row.appendChild(cell);
            }
          });
          tbody.appendChild(row);
        });

        table.appendChild(tbody);
        heatmapMount.appendChild(table);
      } else if (heatmapMount) {
        heatmapMount.appendChild(el('div', {
          className: 'empty-state',
          textContent: 'Single target unit scanned; N×N pair matrix requires at least 2 units.'
        }));
      }

      // Mount Waves
      const wavesMount = document.getElementById('waves-mount');
      if (wavesMount && REPORT.mergeOrder && REPORT.mergeOrder.parallelWaves) {
        REPORT.mergeOrder.parallelWaves.forEach((wave, idx) => {
          const row = el('div', { className: 'wave-row' });
          row.appendChild(el('div', { className: 'wave-badge', textContent: 'Wave ' + (idx + 1) }));
          const unitsGroup = el('div', { className: 'wave-units' });
          wave.forEach(uid => {
            const unitObj = REPORT.units.find(u => u.id === uid);
            const isDirty = unitObj ? unitObj.isDirty : false;
            unitsGroup.appendChild(el('div', {
              className: 'unit-pill' + (isDirty ? ' dirty' : ''),
              textContent: uid + (isDirty ? ' [dirty]' : '')
            }));
          });
          row.appendChild(unitsGroup);
          wavesMount.appendChild(row);
        });
      }

      // Mount Landing Sequence
      const landingMount = document.getElementById('landing-mount');
      if (landingMount && REPORT.mergeOrder && REPORT.mergeOrder.recommendedOrder) {
        REPORT.mergeOrder.recommendedOrder.forEach((uid, idx) => {
          const item = el('div', { className: 'landing-item' });
          item.appendChild(el('span', { className: 'landing-num', textContent: (idx + 1) + '.' }));
          item.appendChild(el('span', { className: 'landing-unit', textContent: uid }));
          const rationaleText = REPORT.mergeOrder.rationale && REPORT.mergeOrder.rationale[uid]
            ? REPORT.mergeOrder.rationale[uid]
            : 'Zero friction landing';
          item.appendChild(el('span', { className: 'landing-rationale', textContent: rationaleText }));
          landingMount.appendChild(item);
        });
      }

      // Severity Pills Setup
      const severityPillsMount = document.getElementById('severity-pills');
      const severities = ['all', 'critical', 'high', 'medium', 'low'];
      severities.forEach(sev => {
        const count = sev === 'all'
          ? REPORT.findings.length
          : (REPORT.summary.bySeverity[sev] || 0);

        const pill = el('button', {
          className: 'filter-pill' + (selectedSeverity === sev ? ' active' : ''),
          onClick: () => {
            selectedSeverity = sev;
            updateFilterPills();
            renderFindings();
          }
        }, [
          el('span', { textContent: sev.charAt(0).toUpperCase() + sev.slice(1) }),
          el('span', { className: 'count-badge', textContent: String(count) })
        ]);
        pill.dataset.sev = sev;
        severityPillsMount.appendChild(pill);
      });

      // Layer Pills Setup
      const layerPillsMount = document.getElementById('layer-pills');
      const layers = ['all', 'semantic', 'textual', 'migration', 'infra', 'dependency'];
      layers.forEach(layer => {
        const count = layer === 'all'
          ? REPORT.findings.length
          : (REPORT.summary.byLayer[layer] || 0);

        const pill = el('button', {
          className: 'filter-pill' + (selectedLayer === layer ? ' active' : ''),
          onClick: () => {
            selectedLayer = layer;
            updateFilterPills();
            renderFindings();
          }
        }, [
          el('span', { textContent: layer.charAt(0).toUpperCase() + layer.slice(1) }),
          el('span', { className: 'count-badge', textContent: String(count) })
        ]);
        pill.dataset.layer = layer;
        layerPillsMount.appendChild(pill);
      });

      function updateFilterPills() {
        document.querySelectorAll('#severity-pills .filter-pill').forEach(p => {
          if (p.dataset.sev === selectedSeverity) p.classList.add('active');
          else p.classList.remove('active');
        });
        document.querySelectorAll('#layer-pills .filter-pill').forEach(p => {
          if (p.dataset.layer === selectedLayer) p.classList.add('active');
          else p.classList.remove('active');
        });
      }

      // Search input handler
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          searchQuery = e.target.value.toLowerCase().trim();
          renderFindings();
        });
      }

      // Pair Filter Banner handlers
      const pairBanner = document.getElementById('pair-filter-banner');
      const pairBannerText = document.getElementById('pair-filter-text');
      const clearPairFilterBtn = document.getElementById('clear-pair-filter-btn');

      function setPairFilter(uA, uB) {
        activePair = [uA, uB];
        pairBannerText.textContent = 'Filtered by pair: ' + uA + ' ↔ ' + uB;
        pairBanner.style.display = 'flex';
        renderFindings();
      }

      if (clearPairFilterBtn) {
        clearPairFilterBtn.addEventListener('click', () => {
          activePair = null;
          pairBanner.style.display = 'none';
          document.querySelectorAll('.heatmap-table td').forEach(c => c.classList.remove('cell-active'));
          renderFindings();
        });
      }

      // Render Findings
      const findingsMount = document.getElementById('findings-mount');
      const countBadge = document.getElementById('findings-count-badge');

      function renderFindings() {
        findingsMount.replaceChildren();

        const filtered = REPORT.findings.filter(f => {
          // Severity filter
          if (selectedSeverity !== 'all' && f.severity !== selectedSeverity) return false;
          // Layer filter
          if (selectedLayer !== 'all' && f.layer !== selectedLayer) return false;
          // Pair filter
          if (activePair) {
            const matchA = (f.unitA === activePair[0] && f.unitB === activePair[1]) ||
                           (f.unitA === activePair[1] && f.unitB === activePair[0]);
            if (!matchA) return false;
          }
          // Search query
          if (searchQuery) {
            const haystack = [
              f.rule,
              f.summary,
              f.evidence,
              f.remediation,
              f.unitA,
              f.unitB,
              ...(f.files || [])
            ].join(' ').toLowerCase();
            if (!haystack.includes(searchQuery)) return false;
          }
          return true;
        });

        countBadge.textContent = filtered.length + ' / ' + REPORT.findings.length;

        if (filtered.length === 0) {
          const empty = el('div', { className: 'empty-state' }, [
            el('div', { className: 'empty-state-icon', textContent: '✔' }, []),
            el('div', {
              style: 'font-size: 16px; font-weight: 600; color: var(--text);',
              textContent: REPORT.findings.length === 0 ? 'Zero Collisions Detected!' : 'No findings match current filter criteria.'
            }, [])
          ]);
          findingsMount.appendChild(empty);
          return;
        }

        filtered.forEach(f => {
          const card = el('div', { className: 'finding-card severity-' + f.severity });

          // Header
          const header = el('div', { className: 'finding-header' });
          const badgeStack = el('div', { className: 'badge-stack' }, [
            el('span', { className: 'badge badge-' + f.severity, textContent: f.severity }),
            el('span', { className: 'badge badge-layer', textContent: f.layer }),
            el('span', { className: 'badge badge-rule', textContent: f.rule }),
            el('span', { className: 'count-badge', textContent: f.id })
          ]);
          header.appendChild(badgeStack);

          const units = el('div', { className: 'units-involved', textContent: f.unitA + ' ↔ ' + f.unitB });
          header.appendChild(units);
          card.appendChild(header);

          // Files
          if (f.files && f.files.length > 0) {
            const filesContainer = el('div', { className: 'finding-files' });
            f.files.forEach(file => {
              let text = file;
              if (f.lineA && f.lineB && f.lineA !== f.lineB) {
                text += ':' + f.lineA + ',' + f.lineB;
              } else if (f.lineA) {
                text += ':' + f.lineA;
              } else if (f.lineB) {
                text += ':' + f.lineB;
              }
              filesContainer.appendChild(el('span', { className: 'file-tag', textContent: text }));
            });
            card.appendChild(filesContainer);
          }

          // Summary
          card.appendChild(el('div', { className: 'finding-summary', textContent: f.summary }));

          // Evidence
          if (f.evidence && f.evidence.trim()) {
            const pre = el('pre', { className: 'evidence-block' }, [
              el('code', { textContent: f.evidence })
            ]);
            card.appendChild(pre);
          }

          // Remediation
          if (f.remediation) {
            const fix = el('div', { className: 'remediation-box' }, [
              el('span', { className: 'remediation-title', textContent: 'Fix:' }),
              el('span', { textContent: f.remediation })
            ]);
            card.appendChild(fix);
          }

          findingsMount.appendChild(card);
        });
      }

      renderFindings();
    })();
  </script>
</body>
</html>`;
}
