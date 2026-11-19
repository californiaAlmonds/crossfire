# Crossfire 💥

> **Zero-dependency collision radar for parallel Git worktrees and autonomous AI coding agents.**  
> Catches zero-conflict semantic contract breaks, database migration clashes, port collisions, and textual conflicts *before* `git merge` lies to you.

[![Zero Runtime Dependencies](https://img.shields.io/badge/dependencies-0_runtime-success.svg?style=flat-square)](package.json)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20.0.0-blue.svg?style=flat-square)](package.json)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)
[![SARIF 2.1.0](https://img.shields.io/badge/SARIF-2.1.0_Compliant-orange.svg?style=flat-square)](https://sarifweb.azurewebsites.net/)
[![Multi-Language](https://img.shields.io/badge/languages-TS_%7C_Python_%7C_Go_%7C_Rust-purple.svg?style=flat-square)](src/analyzers/lexer.ts)

---

## The Problem: Why `git merge` Lies to Parallel Agents

When multiple AI coding agents (Claude Code, Google Antigravity, Cursor, Codex) run in parallel across separate `git worktree` checkouts, **`git merge` and `git merge-tree` only understand byte deltas on identical file lines**.

If Agent A alters an exported function signature in `src/auth.ts`, while Agent B introduces a new caller in `src/checkout.ts`, Git sees two disjoint files with zero line overlaps. Git happily declares:

```text
$ git merge feat/agent-a
Auto-merging src/auth.ts
Auto-merging src/checkout.ts
Merge made by the 'ort' strategy. Clean merge!
```

**And your production build crashes instantly.**

```typescript
// ==========================================
// Agent A in Worktree 1 (src/auth.ts)
// ==========================================
- export function verifySession(token: string) {
+ export function verifySession(token: string, tenantId: string) {
    return token.length > 0 && tenantId.length > 0;
  }

// ==========================================
// Agent B in Worktree 2 (src/checkout.ts)
// ==========================================
  import { verifySession } from './auth.js';
+ export function checkout(token: string) {
+   if (!verifySession(token)) throw new Error('Unauthorized');
+ }
```

Git reports **0 merge conflicts**. But at runtime or compile-time:  
`TypeError: Expected 2 arguments, but got 1.`

**Crossfire intercepts this at the worktree level before code is committed, pushed, or merged.**

---

## 5-Layer Collision Radar Architecture

Crossfire computes a full $N \times N$ pairwise cross-examination between all active worktrees and local branches across 5 defense layers:

| Layer | Type | What Crossfire Catches |
|---|---|---|
| **1. Textual** | `textual` | 3-way `git merge-tree` conflicts, dirty unstaged worktrees, `modify/delete`, and rename collisions without modifying the `.git/index`. |
| **2. Semantic** | `semantic` | `SIGNATURE_ARITY_BREAK`, `RENAMED_EXPORT_STALE_REF`, `DELETED_EXPORT_REFERENCED`, `TYPE_CONTRACT_DRIFT`, and `DUPLICATE_ROUTE_OR_EXPORT` across **TypeScript, Python, Go, and Rust**. Immune to comments and strings. |
| **3. Migration** | `migration` | `MIGRATION_SEQUENCE_CLASH` (e.g. two branches adding `0007_users.sql` and `0007_audit.sql`) and `CONCURRENT_SCHEMA_TABLE_DDL` (conflicting `ALTER TABLE` / Prisma models on the same table). |
| **4. Infra** | `infra` | `PORT_BINDING_CLASH` (both worktrees claiming `PORT=3000` or `8080`) and identical `COMPOSE_PROJECT_NAME` container namespaces. |
| **5. Dependency**| `dependency` | `DEPENDENCY_VERSION_CONFLICT` across `package.json`, `pyproject.toml`, and `Cargo.toml`, plus mutual lockfile churn (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`). |

### Optimal Merge-Order & Parallel Wave Solver
Crossfire constructs a collision conflict graph between all target units and executes a greedy chromatic scheduling solver. It outputs:
1. **Parallel Execution Waves**: Independent sets of worktrees guaranteed to have **zero mutual collisions** that can merge or run tests simultaneously.
2. **Recommended Landing Sequence**: Safest-first merge order that minimizes rebase friction.

---

## Sample Terminal Output

```text
══════════════════════════════════════════════════════════════════════════════
CROSSFIRE v1.0.0 — Parallel Worktree & Branch Collision Radar
Repo: /workspace/acme-service  •  Scan Time: 34ms  •  Generated: 2026-11-19T08:50:00Z
Units (5): wt:main, wt:agent-auth [dirty], wt:agent-billing [dirty], wt:agent-db, wt:agent-ui
Severity Counts: 1 CRITICAL  |  2 HIGH  |  0 MEDIUM  |  0 LOW  (Total Findings: 3)
══════════════════════════════════════════════════════════════════════════════

COLLISION MATRIX
──────────────────────────────────────────────────────────────────────────────
Unit                 │    [1]    [2]    [3]    [4]    [5]
─────────────────────┼───────────────────────────────────
[1] wt:main          │     ·      ✓      ✓      ✓      ✓ 
[2] wt:agent-auth    │     ✓      ·    ✗25    ✗20      ✓ 
[3] wt:agent-billing │     ✓    ✗25      ·      ✓      ✓ 
[4] wt:agent-db      │     ✓    ✗20      ✓      ·      ✓ 
[5] wt:agent-ui      │     ✓      ✓      ✓      ✓      · 
──────────────────────────────────────────────────────────────────────────────
Legend: · Self  |  ✓ Clean  |  !W Warning  |  ✗<score> Conflict (score = weighted findings)

FINDINGS DIGEST
──────────────────────────────────────────────────────────────────────────────
[CRITICAL] [SEMANTIC/SIGNATURE_ARITY_BREAK] wt:agent-auth <-> wt:agent-billing
  Files: src/auth.ts (lines 1 & 5), src/checkout.ts (lines 1 & 5)
  Summary: Arity break on verifySession (2-2 args) by wt:agent-auth, called with 1 args in wt:agent-billing
  Evidence: export function verifySession(token: string, tenantId: string)
  Fix: Update call site in src/checkout.ts to match new signature.

[HIGH] [INFRA/PORT_BINDING_CLASH] wt:agent-auth <-> wt:agent-db
  Files: .env
  Summary: Port binding clash: both units bind host port 4000
  Evidence: Unit wt:agent-auth binds port 4000 in .env; Unit wt:agent-db binds port 4000 in .env
  Fix: Use 'crossfire isolate' or reassign port 4000 in one of the units.

OPTIMAL MERGE ORDER & PARALLEL WAVES
──────────────────────────────────────────────────────────────────────────────
Parallel Execution Waves (Zero Mutual Collisions):
  Wave 1 (parallel safe): wt:main, wt:agent-ui, wt:agent-db, wt:agent-billing
  Wave 2 (parallel safe): wt:agent-auth

Recommended Landing Sequence:
  1. wt:main — Zero collisions with all peers; safe to merge in Wave 1.
  2. wt:agent-ui — Zero collisions with all peers; safe to merge in Wave 1.
  3. wt:agent-db — Collides with wt:agent-auth (score 20); placed in Wave 1.
  4. wt:agent-billing — Collides with wt:agent-auth (score 25); placed in Wave 1.
  5. wt:agent-auth — Collides with wt:agent-billing (score 25); placed in Wave 2.
══════════════════════════════════════════════════════════════════════════════
```

---

## Quickstart

Run directly via `npx` without installing anything:

```bash
# Scan active worktrees and uncommitted changes
npx crossfire-git scan

# Pre-merge gate: exits 1 if any critical or high collisions exist
npx crossfire-git check --fail-on high

# Generate interactive offline HTML Collision Radar
npx crossfire-git report --html radar.html
```

Or install globally:

```bash
npm install -g crossfire-git
crossfire scan
```

---

## CLI Reference

```text
crossfire [command] [options]

COMMANDS
  scan          Scan active Git worktrees (and optional branches) for collisions [default]
  check         CI / pre-merge gate; exits 1 when collisions meet --fail-on threshold
  report        Generate an offline XSS-safe HTML Radar, SARIF v2.1.0, or JSON report
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
  -h, --help               Show help message
  -v, --version            Print version
```

---

## AI Coding Agent Integration

Crossfire is built ground-up for autonomous parallel agent environments like **Claude Code**, **Google Antigravity**, **Cursor**, and **Codex**.

### Setup in 1 Second

Run in your repository root:

```bash
crossfire init-agent --write
```

This generates:
1. **Agent Skill** (`.agents/skills/crossfire/SKILL.md`): Teaches agents to self-inspect with `crossfire check --json` before editing shared interfaces or merging branches.
2. **Pre-Merge Hook** (`.git/hooks/pre-merge-commit`): Automatically prevents agents from finalizing merges if breaking collisions exist.

### Multi-Worktree Port Isolation (`crossfire isolate`)

Running multiple agents locally often causes `Error: listen EADDRINUSE :::3000`. Crossfire automatically allocates isolated ports and Docker container namespaces across all active worktrees:

```bash
# Preview port allocations
crossfire isolate

# Write .env.worktree.local into each active worktree directory
crossfire isolate --write --base-port 4000
```

Each worktree receives a collision-proof environment file:
```env
# Generated by crossfire isolate
PORT=4010
APP_PORT=4010
VITE_PORT=6010
COMPOSE_PROJECT_NAME=myrepo-wt-agent-billing
```

---

## GitHub Actions CI / SARIF Integration

Add Crossfire to your CI workflow to post findings directly into **GitHub Code Scanning Alerts**:

```yaml
name: Crossfire Collision Radar

on:
  pull_request:
    branches: [main, master]

jobs:
  crossfire:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run Crossfire SARIF Scan
        run: npx crossfire-git report --all-branches --sarif -o crossfire.sarif

      - name: Upload SARIF to GitHub Code Scanning
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: crossfire.sarif

      - name: Enforce Pre-Merge Gate
        run: npx crossfire-git check --all-branches --fail-on high
```

---

## Live 4-Agent Demo

Experience Crossfire in action on a real simulated 4-agent parallel worktree repository:

```bash
git clone https://github.com/californiaAlmonds/crossfire.git
cd crossfire
npm install
npm run demo
```

This spins up 4 parallel agent worktrees (`agent-auth`, `agent-billing`, `agent-db`, `agent-ui`), runs the multi-layer scanner, displays the ANSI Collision Radar, and writes `crossfire-report.html` for you to open in your browser.

---

## Read-Only Working-Tree Safety Guarantee

Crossfire guarantees **zero side-effects on your working trees**:
- When scanning uncommitted edits, it constructs ephemeral in-memory trees using isolated temporary indices via `GIT_INDEX_FILE`.
- It **never** invokes `git stash`, never alters `.git/index`, never writes unstaged files, and leaves `git status --porcelain` 100% untouched.

---

## License

GNU General Public License v3.0 (`GPL-3.0-only`). See [LICENSE](LICENSE) for full details.
