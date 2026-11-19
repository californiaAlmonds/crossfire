import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentInitResult } from './types.js';

export async function generateAgentIntegration(
  repoRoot: string,
  write: boolean,
): Promise<AgentInitResult> {
  const skillPath = path.join(
    repoRoot,
    '.agents',
    'skills',
    'crossfire',
    'SKILL.md',
  );
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-merge-commit');

  const skillContent = `---
name: crossfire
description: Collision radar for parallel Git worktrees and AI coding agents. Run before editing shared contracts or merging parallel worktrees to detect semantic symbol breaks, migration clashes, port collisions, and textual conflicts.
---

# Crossfire Collision Radar Skill

Crossfire is a zero-dependency collision radar designed for parallel Git worktrees and AI coding agents (Claude Code, Antigravity, Cursor, Codex). It detects merge conflicts, semantic contract breaks, database migration clashes, and infrastructure port overlaps before \`git merge\` runs.

## Core Directives for AI Agents

1. **Before Modifying Shared Contracts**:
   Whenever you plan to modify shared types, exported functions, interfaces, database schemas, or route definitions in a parallel worktree, run:
   \`\`\`bash
   npx crossfire check --json
   \`\`\`
   Check whether any peer branch or worktree is consuming or concurrently editing the same contracts.

2. **Before Merging Parallel Worktrees or Branches**:
   Before initiating a merge or opening a PR, ensure there are no breaking collisions:
   \`\`\`bash
   npx crossfire check --fail-on high
   \`\`\`

3. **Multi-Worktree Local Port Isolation**:
   If starting dev servers across multiple worktrees, allocate collision-free ports and environment files:
   \`\`\`bash
   npx crossfire isolate --write
   \`\`\`

## Common Collision Rules and Remediation
- \`SIGNATURE_ARITY_BREAK\`: An exported function signature changed arity while a peer worktree added calls expecting the old arity. Add default values or update call sites.
- \`INTERFACE_CONTRACT_BREAK\`: Interface fields were removed or changed incompatibly. Retain backwards-compatible optional fields.
- \`MIGRATION_SEQUENCE_CLASH\`: Multiple worktrees generated database migration files with duplicate version timestamps or sequential numbers. Re-sequence migration files.
- \`INFRA_PORT_OVERLAP\`: Multiple worktrees bind identical dev server or container ports. Use \`npx crossfire isolate\` to auto-assign non-colliding ports.
- \`TEXT_CONFLICT\`: Both branches edit identical lines in a file. Coordinate merge order or rebase before landing.
`;

  const hookContent = `#!/bin/sh
# Crossfire Pre-Merge Commit Hook
# Verifies zero critical or high collisions between parallel worktrees and branches before committing a merge.

if command -v npx >/dev/null 2>&1; then
  echo "🔍 [crossfire] Running collision radar across active worktrees..."
  npx --no-install crossfire check --fail-on high
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    echo "❌ [crossfire] Collision check failed with exit code $EXIT_CODE. Resolve conflicting symbols or migrations before merging." >&2
    exit $EXIT_CODE
  fi
  echo "✅ [crossfire] Collision check passed cleanly."
else
  echo "⚠️  [crossfire] npx not found; skipping collision check."
fi

exit 0
`;

  if (write) {
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, skillContent, 'utf8');

    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, hookContent, 'utf8');
    await fs.chmod(hookPath, 0o755).catch(() => {});
  }

  return {
    skillPath,
    hookPath,
    written: write,
    skillContent,
    hookContent,
  };
}
