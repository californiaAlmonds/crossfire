import process from 'node:process';
import type {
  CollisionFinding,
  IsolationPlan,
  PairReport,
  ScanReport,
  Severity,
} from '../types.js';

export interface AnsiRenderOptions {
  color?: boolean;
  maxFindings?: number;
}

function makeColorizer(enabled: boolean) {
  const code = (open: number, close: number) =>
    enabled
      ? (s: string | number) => `\x1b[${open}m${s}\x1b[${close}m`
      : (s: string | number) => String(s);

  return {
    bold: code(1, 22),
    dim: code(2, 22),
    italic: code(3, 23),
    underline: code(4, 24),
    red: code(31, 39),
    green: code(32, 39),
    yellow: code(33, 39),
    blue: code(34, 39),
    magenta: code(35, 39),
    cyan: code(36, 39),
    white: code(37, 39),
    gray: code(90, 39),
    brightRed: code(91, 39),
    brightGreen: code(92, 39),
    brightYellow: code(93, 39),
    brightBlue: code(94, 39),
    brightMagenta: code(95, 39),
    brightCyan: code(96, 39),
    bgRed: code(41, 49),
    bgGreen: code(42, 49),
    bgYellow: code(43, 49),
  };
}

export function renderAnsiReport(
  report: ScanReport,
  options?: AnsiRenderOptions,
): string {
  const useColor =
    options?.color ?? Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
  const maxFindings = options?.maxFindings ?? 50;
  const c = makeColorizer(useColor);

  const lines: string[] = [];
  const divider = '─'.repeat(78);
  const thickDivider = '═'.repeat(78);

  // 1. Crisp header banner
  lines.push(c.cyan(thickDivider));
  lines.push(
    `${c.bold(c.brightCyan('CROSSFIRE'))} ${c.dim(`v${report.toolVersion}`)} ${c.gray('— Parallel Worktree & Branch Collision Radar')}`,
  );
  lines.push(
    `${c.dim('Repo:')} ${report.repoRoot}  ${c.dim('•  Scan Time:')} ${report.durationMs}ms  ${c.dim('•  Generated:')} ${report.generatedAt}`,
  );

  const unitSummaries = report.units.map((u) => {
    const dirtyBadge = u.isDirty ? c.yellow(' [dirty]') : '';
    return `${u.id}${dirtyBadge}`;
  });
  lines.push(
    `${c.dim('Units (' + report.units.length + '):')} ${unitSummaries.join(', ') || '(none)'}`,
  );

  const sevCritical = c.brightRed(`${report.summary.bySeverity.critical} CRITICAL`);
  const sevHigh = c.red(`${report.summary.bySeverity.high} HIGH`);
  const sevMed = c.yellow(`${report.summary.bySeverity.medium} MEDIUM`);
  const sevLow = c.blue(`${report.summary.bySeverity.low} LOW`);
  lines.push(
    `${c.dim('Severity Counts:')} ${sevCritical}  ${c.dim('|')}  ${sevHigh}  ${c.dim('|')}  ${sevMed}  ${c.dim('|')}  ${sevLow}  ${c.dim(`(Total Findings: ${report.findings.length})`)}`,
  );
  lines.push(c.cyan(thickDivider));
  lines.push('');

  // 2. N×N Collision Matrix (when units.length >= 2)
  if (report.units.length >= 2) {
    lines.push(c.bold('COLLISION MATRIX'));
    lines.push(c.dim(divider));

    // Index map for pairs
    const pairMap = new Map<string, PairReport>();
    for (const pair of report.pairs) {
      pairMap.set(`${pair.unitA}:::${pair.unitB}`, pair);
      pairMap.set(`${pair.unitB}:::${pair.unitA}`, pair);
    }

    const n = report.units.length;
    // Row label width
    const maxIdLen = Math.min(
      28,
      Math.max(...report.units.map((u, i) => `[${i + 1}] ${u.id}`.length)),
    );
    const cellWidth = 7;

    // Header row
    let header = 'Unit'.padEnd(maxIdLen) + ' │';
    for (let j = 0; j < n; j++) {
      header += ` [${j + 1}]`.padStart(cellWidth);
    }
    lines.push(header);

    // Matrix divider
    const matrixDivider =
      '─'.repeat(maxIdLen) + '─┼' + '─'.repeat(n * cellWidth);
    lines.push(c.dim(matrixDivider));

    // Matrix rows
    for (let i = 0; i < n; i++) {
      const uA = report.units[i];
      if (!uA) continue;
      const rowLabel = `[${i + 1}] ${uA.id}`;
      const truncatedLabel =
        rowLabel.length > maxIdLen
          ? rowLabel.slice(0, maxIdLen - 1) + '…'
          : rowLabel.padEnd(maxIdLen);

      let rowStr = truncatedLabel + ' │';

      for (let j = 0; j < n; j++) {
        const uB = report.units[j];
        if (!uB) continue;
        if (i === j) {
          const selfCell = ' · '.padStart(cellWidth);
          rowStr += c.dim(selfCell);
        } else {
          const pair = pairMap.get(`${uA.id}:::${uB.id}`);
          if (!pair || pair.status === 'clean') {
            const cleanCell = ' ✓ '.padStart(cellWidth);
            rowStr += c.green(cleanCell);
          } else if (pair.status === 'warn') {
            const warnCell = ' !W '.padStart(cellWidth);
            rowStr += c.yellow(warnCell);
          } else {
            const conflictText = ` ✗${pair.score} `;
            const conflictCell = conflictText.padStart(cellWidth);
            rowStr += c.brightRed(c.bold(conflictCell));
          }
        }
      }
      lines.push(rowStr);
    }

    lines.push(c.dim(divider));
    lines.push(
      c.dim(
        `Legend: ${c.dim('·')} Self  |  ${c.green('✓')} Clean  |  ${c.yellow('!W')} Warning  |  ${c.brightRed('✗<score>')} Conflict (score = weighted findings)`,
      ),
    );
    lines.push('');
  }

  // 3. Findings Digest
  lines.push(c.bold('FINDINGS DIGEST'));
  lines.push(c.dim(divider));

  if (report.findings.length === 0) {
    lines.push(
      c.green(
        `✔ ALL CLEAR: Zero textual, semantic, migration, or infrastructure collisions detected across ${report.units.length} unit(s).`,
      ),
    );
  } else {
    const displayed = report.findings.slice(0, maxFindings);
    for (const f of displayed) {
      const sevColored = formatSeverityBadge(f.severity, c);
      const headerLine = `${sevColored} ${c.dim(`[${f.layer.toUpperCase()}/${f.rule}]`)} ${c.bold(`${f.unitA} <-> ${f.unitB}`)}`;
      lines.push(headerLine);

      // Files line with line numbers
      if (f.files.length > 0) {
        const fileParts = f.files.map((file) => {
          let s = file;
          if (f.lineA && f.lineB && f.lineA !== f.lineB) {
            s += ` (lines ${f.lineA} & ${f.lineB})`;
          } else if (f.lineA) {
            s += `:${f.lineA}`;
          } else if (f.lineB) {
            s += `:${f.lineB}`;
          }
          return s;
        });
        lines.push(`  ${c.dim('Files:')} ${fileParts.join(', ')}`);
      }

      lines.push(`  ${c.dim('Summary:')} ${f.summary}`);

      if (f.evidence.trim()) {
        lines.push(`  ${c.dim('Evidence:')}`);
        for (const evLine of f.evidence.split('\n')) {
          lines.push(`    ${c.gray(evLine)}`);
        }
      }

      lines.push(`  ${c.cyan('Fix:')} ${f.remediation}`);
      lines.push('');
    }

    if (report.findings.length > maxFindings) {
      lines.push(
        c.yellow(
          `  ... and ${report.findings.length - maxFindings} more findings truncated. (Use maxFindings option to view all)`,
        ),
      );
    }
  }
  lines.push('');

  // 4. Optimal Merge Order & Parallel Waves
  lines.push(c.bold('OPTIMAL MERGE ORDER & PARALLEL WAVES'));
  lines.push(c.dim(divider));

  if (report.mergeOrder.parallelWaves.length > 0) {
    lines.push(c.dim('Parallel Execution Waves (Zero Mutual Collisions):'));
    report.mergeOrder.parallelWaves.forEach((wave, idx) => {
      lines.push(
        `  ${c.cyan(`Wave ${idx + 1}`)} ${c.dim('(parallel safe):')} ${wave.map((u) => c.bold(u)).join(', ')}`,
      );
    });
    lines.push('');
  }

  if (report.mergeOrder.recommendedOrder.length > 0) {
    lines.push(c.dim('Recommended Landing Sequence:'));
    report.mergeOrder.recommendedOrder.forEach((unitId, idx) => {
      const rationale = report.mergeOrder.rationale[unitId];
      const rationaleStr = rationale ? ` ${c.gray(`— ${rationale}`)}` : '';
      lines.push(`  ${c.dim(`${idx + 1}.`)} ${c.bold(unitId)}${rationaleStr}`);
    });
  }
  lines.push(c.cyan(thickDivider));

  return lines.join('\n');
}

function formatSeverityBadge(
  severity: Severity,
  c: ReturnType<typeof makeColorizer>,
): string {
  switch (severity) {
    case 'critical':
      return c.bold(c.brightRed('[CRITICAL]'));
    case 'high':
      return c.bold(c.red('[HIGH]'));
    case 'medium':
      return c.yellow('[MEDIUM]');
    case 'low':
      return c.blue('[LOW]');
  }
}

export function renderIsolationPlanAnsi(
  plan: IsolationPlan,
  color?: boolean,
): string {
  const useColor =
    color ?? Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
  const c = makeColorizer(useColor);

  const lines: string[] = [];
  const divider = '─'.repeat(78);

  lines.push(c.bold('WORKTREE ENVIRONMENT ISOLATION PLAN'));
  lines.push(c.dim(`Base Port: ${plan.basePort}`));
  lines.push(c.dim(divider));

  const colUnit = 22;
  const colPort = 8;
  const colVite = 11;
  const colCompose = 24;

  const header =
    'Unit ID'.padEnd(colUnit) +
    'PORT'.padEnd(colPort) +
    'VITE_PORT'.padEnd(colVite) +
    'COMPOSE_PROJECT_NAME'.padEnd(colCompose) +
    'ENV FILE';
  lines.push(c.bold(header));
  lines.push(c.dim(divider));

  for (const alloc of plan.allocations) {
    const uStr = alloc.unitId.padEnd(colUnit);
    const pStr = String(alloc.assignedPort).padEnd(colPort);
    const vStr = String(alloc.assignedVitePort).padEnd(colVite);
    const cStr = alloc.composeProjectName.padEnd(colCompose);
    lines.push(`${c.cyan(uStr)}${pStr}${vStr}${cStr}${alloc.envFilePath}`);
  }

  lines.push(c.dim(divider));
  if (plan.writtenFiles.length > 0) {
    lines.push(
      c.green(
        `✔ Written ${plan.writtenFiles.length} isolation file(s): ${plan.writtenFiles.join(', ')}`,
      ),
    );
  } else {
    lines.push(
      c.yellow('ℹ Dry-run mode: no isolation files were written to disk.'),
    );
  }

  return lines.join('\n');
}
