# Changelog

All notable changes to **Crossfire** are documented in this file. This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-19

### Added
- **Live Dirty-Worktree Ephemeral Snapshotter**: Captures uncommitted staged, unstaged, and untracked edits across active `git worktree` checkouts using isolated temporary `GIT_INDEX_FILE` trees without mutating `.git/index` or refs.
- **3-Way Textual Conflict Engine**: Wraps `git merge-tree --write-tree --messages` across every worktree/branch pair to surface content, add/add, modify/delete, and rename collisions.
- **Cross-Branch Semantic Contract Analyzer**: Comment- and string-safe lexical & signature extractor across TypeScript/JavaScript, Python, Go, and Rust catching `DELETED_EXPORT_REFERENCED`, `RENAMED_EXPORT_STALE_REF`, `SIGNATURE_ARITY_BREAK`, `TYPE_CONTRACT_DRIFT`, and `DUPLICATE_ROUTE_OR_EXPORT` across non-overlapping files.
- **Infrastructure, Migration & Dependency Analyzer**: Detects `MIGRATION_SEQUENCE_CLASH`, `CONCURRENT_SCHEMA_TABLE_DDL`, `PORT_BINDING_CLASH`, `DEPENDENCY_VERSION_CONFLICT`, and `LOCKFILE_CHURN_RISK`.
- **Optimal Merge-Order & Parallel Wave Planner**: Computes minimum-blast-radius landing order and zero-collision parallel execution waves.
- **Worktree Port Isolator (`crossfire isolate`)**: Generates deterministic non-colliding `.env.worktree.local` port and `COMPOSE_PROJECT_NAME` allocations.
- **Multi-Surface Reporters & Agent Guardrails**: Rich ANSI N×N matrix, offline XSS-safe interactive HTML Collision Radar, GitHub SARIF v2.1.0, deterministic JSON, and `crossfire init-agent` (`SKILL.md` + `pre-merge-commit` hook).
