# Contributing to Crossfire

Thank you for helping improve **Crossfire**! Crossfire is built with a strict **zero-runtime-dependency** philosophy so teams and AI coding agents can run `npx crossfire-git` instantaneously without supply-chain bloat.

## Core Design Principles

1. **Zero Runtime Dependencies**: Only Node.js (`>=20`) standard library modules (`node:child_process`, `node:fs`, `node:crypto`, `node:util`, `node:path`, `node:os`) are allowed in `src/` and `bin/`.
2. **Read-Only Git Safety by Default**: `scan`, `check`, and `report` must never mutate `HEAD`, `refs/*`, `.git/index`, or working tree files. Ephemeral snapshots for dirty worktrees must use isolated `GIT_INDEX_FILE` paths in `os.tmpdir()` cleaned up inside `finally`.
3. **Shell-Injection & XSS Immunity**:
   - Always invoke Git via `spawn` / `execFile` with `shell: false`.
   - Always escape untrusted branch names, paths, and source lines via `escapeHtml` and `safeJsonEmbed` in HTML reports.
4. **Cross-Platform Determinism**: Normalize repository-relative paths to POSIX forward slashes (`/`) so Windows, macOS, and Linux produce identical finding IDs and JSON/SARIF reports.

## Local Development

```bash
git clone https://github.com/californiaAlmonds/crossfire.git
cd crossfire
npm install
npm run typecheck
npm test
npm run demo
```

## Adding a New Language or Collision Rule

- **Language symbol support**: Update `detectLanguage` and `stripCommentsAndStrings` in `src/analyzers/lexer.ts`, then add export/reference extraction in `src/analyzers/symbols.ts` alongside multi-worktree integration tests in `test/`.
- **Infra / schema rules**: Add deterministic matchers in `src/analyzers/infra.ts` using `makeFindingId` for stable deduplication.

## Submitting Pull Requests

1. Open an issue or discussion describing the bug or collision vector first if the change is architectural.
2. Add a regression test in `test/` exercising a real temporary Git repository/worktree setup.
3. Ensure `npm run typecheck` and `npm test` pass cleanly.
4. By submitting a contribution, you agree that your work will be licensed under the project's **GNU GPLv3** license (`LICENSE`).
