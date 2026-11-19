import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { generateAgentIntegration } from './agent-init.js';
import { scanRepository } from './engine.js';
import { resolveRepoRoot } from './git/exec.js';
import { discoverTargets } from './git/snapshot.js';
import { applyWorktreeIsolation, planWorktreeIsolation } from './isolate.js';
import {
  renderAnsiReport,
  renderIsolationPlanAnsi,
} from './reporters/ansi.js';
import { renderHtmlReport } from './reporters/html.js';
import { renderSarifReport } from './reporters/sarif.js';
import type { Severity } from './types.js';
import { CROSSFIRE_VERSION, meetsFailThreshold } from './utils.js';

const HELP_TEXT = `crossfire v${CROSSFIRE_VERSION} — Semantic, schema & infra collision radar for parallel Git worktrees

USAGE
  crossfire [command] [options]

COMMANDS
  scan          Scan active Git worktrees (and optional branches) for collisions [default]
  check         CI / pre-merge gate; exits 1 when collisions meet --fail-on severity
  report        Generate an offline XSS-safe HTML Radar, SARIF, or JSON report
  isolate       Compute (or --write) non-colliding PORT / COMPOSE_PROJECT_NAME per worktree
  init-agent    Generate AI coding agent SKILL.md + pre-merge-commit hook

OPTIONS
  -C, --cwd <dir>          Repository or worktree path (default: current directory)
  -b, --branch <name>      Additional branch name/glob to include (repeatable)
  -a, --all-branches       Include all local refs/heads/* branches alongside worktrees
      --committed-only     Skip uncommitted/untracked working-tree synthesis
  -t, --target <unit>      Focus pairwise checks involving a specific worktree or branch
      --fail-on <sev>      Exit 1 threshold for 'check': critical | high | medium | low (default: high)
      --json               Emit deterministic JSON report to stdout
      --sarif              Emit GitHub Code Scanning SARIF v2.1.0 JSON to stdout
      --html <file>        Write interactive self-contained HTML Collision Radar to <file>
  -o, --output <file>      Write primary output to <file>
      --base-port <port>   Starting port for 'isolate' (default: 3100)
      --write              Persist generated files in 'isolate' or 'init-agent' (dry-run by default)
      --no-color           Disable ANSI colors
  -h, --help               Show this help message
  -v, --version            Print version
`;

const VALID_SEVERITIES = new Set<Severity>([
  'critical',
  'high',
  'medium',
  'low',
]);

export async function runCli(
  argv: string[],
  io: {
    stdout?: (s: string) => void;
    stderr?: (s: string) => void;
    cwd?: string;
  } = {},
): Promise<number> {
  const out = io.stdout ?? ((s: string) => process.stdout.write(s));
  const err = io.stderr ?? ((s: string) => process.stderr.write(s));

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        cwd: { type: 'string', short: 'C' },
        branch: { type: 'string', short: 'b', multiple: true },
        'all-branches': { type: 'boolean', short: 'a', default: false },
        'committed-only': { type: 'boolean', default: false },
        target: { type: 'string', short: 't' },
        'fail-on': { type: 'string', default: 'high' },
        json: { type: 'boolean', default: false },
        sarif: { type: 'boolean', default: false },
        html: { type: 'string' },
        output: { type: 'string', short: 'o' },
        'base-port': { type: 'string', default: '3100' },
        write: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    err(`crossfire: ${msg}\nRun 'crossfire --help' for usage.\n`);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    out(`${CROSSFIRE_VERSION}\n`);
    return 0;
  }

  if (values.help) {
    out(HELP_TEXT);
    return 0;
  }

  const command = positionals[0] ?? 'scan';
  if (
    !['scan', 'check', 'report', 'isolate', 'init-agent'].includes(command)
  ) {
    err(
      `crossfire: unknown command '${command}'. Expected scan | check | report | isolate | init-agent.\n`,
    );
    return 2;
  }

  const startDir = resolve(io.cwd ?? process.cwd(), String(values.cwd ?? '.'));
  let repoRoot: string;
  try {
    repoRoot = await resolveRepoRoot(startDir);
  } catch (gitErr) {
    const msg = gitErr instanceof Error ? gitErr.message : String(gitErr);
    err(`crossfire: not inside a Git repository (${startDir}): ${msg}\n`);
    return 2;
  }

  const useColor =
    !values['no-color'] && Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

  if (command === 'isolate') {
    const basePort = Number.parseInt(String(values['base-port'] ?? '3100'), 10);
    if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 60000) {
      err(`crossfire: --base-port must be an integer between 1024 and 60000.\n`);
      return 2;
    }
    const units = await discoverTargets({
      repoRoot,
      committedOnly: true,
    });
    const plan = await applyWorktreeIsolation(
      planWorktreeIsolation(units, basePort),
      Boolean(values.write),
    );
    if (values.json) {
      out(`${JSON.stringify(plan, null, 2)}\n`);
    } else {
      out(`${renderIsolationPlanAnsi(plan, useColor)}\n`);
    }
    return 0;
  }

  if (command === 'init-agent') {
    const result = await generateAgentIntegration(
      repoRoot,
      Boolean(values.write),
    );
    if (values.json) {
      out(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.written) {
      out(
        `Wrote AI agent integration:\n  Skill: ${result.skillPath}\n  Hook:  ${result.hookPath}\n`,
      );
    } else {
      out(
        `Dry-run preview (pass --write to persist):\n  Skill: ${result.skillPath}\n  Hook:  ${result.hookPath}\n`,
      );
    }
    return 0;
  }

  const failOnRaw = String(values['fail-on'] ?? 'high').toLowerCase() as Severity;
  if (!VALID_SEVERITIES.has(failOnRaw)) {
    err(
      `crossfire: invalid --fail-on '${failOnRaw}'. Expected critical | high | medium | low.\n`,
    );
    return 2;
  }

  const branches = Array.isArray(values.branch)
    ? values.branch.map(String)
    : undefined;

  const report = await scanRepository({
    repoRoot,
    branches,
    allBranches: Boolean(values['all-branches']),
    committedOnly: Boolean(values['committed-only']),
    focusTarget: values.target ? String(values.target) : undefined,
  });

  if (values.html) {
    const htmlPath = resolve(io.cwd ?? process.cwd(), String(values.html));
    await writeFile(htmlPath, renderHtmlReport(report), 'utf8');
    if (!values.json && !values.sarif && command === 'report') {
      out(`Wrote HTML Collision Radar to ${htmlPath}\n`);
    }
  }

  let primaryText: string | null = null;
  if (values.sarif) {
    primaryText = `${renderSarifReport(report)}\n`;
  } else if (values.json) {
    primaryText = `${JSON.stringify(report, null, 2)}\n`;
  } else if (command !== 'report' || !values.html) {
    primaryText = `${renderAnsiReport(report, { color: useColor })}\n`;
  }

  if (values.output && primaryText !== null) {
    const outPath = resolve(io.cwd ?? process.cwd(), String(values.output));
    await writeFile(outPath, primaryText, 'utf8');
  } else if (primaryText !== null) {
    out(primaryText);
  }

  if (command === 'check') {
    const shouldFail = report.findings.some((f) =>
      meetsFailThreshold(f.severity, failOnRaw),
    );
    return shouldFail ? 1 : 0;
  }

  return 0;
}
