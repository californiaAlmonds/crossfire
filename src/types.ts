/**
 * Tier-0 Shared Contracts for Crossfire.
 * Every parallel module imports exclusively from `./types.js` and `./utils.js`
 * so all JSON outputs serialize cleanly (no Map/Set/Infinity) and cross-module APIs are locked.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type CollisionLayer =
  | 'textual'
  | 'semantic'
  | 'migration'
  | 'infra'
  | 'dependency';

export interface TargetUnit {
  /** Stable identifier, e.g. "wt:main", "wt:feat-auth", or "branch:feat/billing" */
  id: string;
  kind: 'worktree' | 'branch';
  /** Short branch name if on a branch, or null if detached HEAD */
  branch: string | null;
  /** Absolute filesystem path when kind === 'worktree' */
  worktreePath?: string;
  /** Committed HEAD SHA-1/SHA-256 OID */
  headOid: string;
  /** Ephemeral commit OID capturing uncommitted staged+unstaged+untracked edits (equals headOid when clean or --committed-only) */
  effectiveOid: string;
  /** Whether uncommitted or untracked non-ignored files were synthesized into effectiveOid */
  isDirty: boolean;
  /** Number of dirty/untracked files captured in effectiveOid */
  dirtyFileCount: number;
  /** JSON-safe map of peer unit ID -> repo-relative POSIX paths changed since their merge-base */
  changedFilesByPeer: Record<string, string[]>;
}

export interface ChangedFileDelta {
  /** Repo-relative POSIX forward-slash path */
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  /** Previous repo-relative POSIX path if renamed */
  oldPath?: string;
  /** UTF-8 file content at merge-base (null if added or binary) */
  baseContent: string | null;
  /** UTF-8 file content at unit's effectiveOid (null if deleted or binary) */
  headContent: string | null;
  /** True when the blob contains NUL bytes and was skipped for text/AST parsing */
  isBinary: boolean;
}

export type FileContentLookup = (
  oid: string,
  posixPath: string,
) => Promise<string | null>;

export interface PairDiffContext {
  repoRoot: string;
  unitA: TargetUnit;
  unitB: TargetUnit;
  mergeBaseOid: string;
  deltasA: ChangedFileDelta[];
  deltasB: ChangedFileDelta[];
}

export type SupportedLanguage = 'ts' | 'python' | 'go' | 'rust';

export interface ExportedSymbol {
  name: string;
  /** Repo-relative POSIX path */
  file: string;
  /** 1-based line number */
  line: number;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'route';
  /** Minimum required positional arguments (functions/methods) */
  minArgs?: number;
  /** Maximum positional arguments, or null if variadic/rest (...args, *args) */
  maxArgs?: number | null;
  /** Required field/property names (interfaces, types, structs, dataclasses) */
  fields?: string[];
  /** Normalized human-readable declaration header */
  rawSignature: string;
}

export interface SymbolReference {
  name: string;
  /** Repo-relative POSIX path */
  file: string;
  /** 1-based line number */
  line: number;
  kind: 'import' | 'call' | 'type_ref';
  /** Observed call-site argument count when kind === 'call' (undefined if spread `...` used) */
  argCount?: number;
  /** Raw module specifier when kind === 'import', e.g. './auth.js' or '../lib/db' */
  fromModule?: string;
}

export interface CollisionFinding {
  /** Deterministic short hash ID */
  id: string;
  layer: CollisionLayer;
  /** Machine-stable rule ID, e.g. 'TEXT_CONFLICT', 'SIGNATURE_ARITY_BREAK', 'MIGRATION_SEQUENCE_CLASH' */
  rule: string;
  severity: Severity;
  unitA: string;
  unitB: string;
  /** Repo-relative POSIX file paths involved */
  files: string[];
  lineA?: number;
  lineB?: number;
  summary: string;
  evidence: string;
  remediation: string;
}

export interface PairReport {
  unitA: string;
  unitB: string;
  mergeBaseOid: string;
  /** Weighted collision score (critical=25, high=10, medium=4, low=1) */
  score: number;
  status: 'clean' | 'warn' | 'conflict';
  counts: Record<Severity, number>;
  findings: CollisionFinding[];
}

export interface MergeOrderPlan {
  /** Ordered list of TargetUnit IDs from safest-first to highest-friction-last */
  recommendedOrder: string[];
  /** Groups of TargetUnit IDs that have zero mutual collisions and can merge/run in parallel */
  parallelWaves: string[][];
  /** Per-unit explanation of its placement */
  rationale: Record<string, string>;
}

export interface ScanOptions {
  repoRoot: string;
  /** Include local branches in addition to active git worktrees (or specific branch globs/names) */
  branches?: string[];
  /** Include all local branches */
  allBranches?: boolean;
  /** Only inspect committed HEADs, skipping uncommitted working-tree synthesis */
  committedOnly?: boolean;
  /** Optional target unit ID or branch name to filter pairs against */
  focusTarget?: string;
}

export interface ScanReport {
  toolVersion: string;
  repoRoot: string;
  generatedAt: string;
  durationMs: number;
  units: TargetUnit[];
  pairs: PairReport[];
  findings: CollisionFinding[];
  summary: {
    totalUnits: number;
    dirtyUnits: number;
    totalPairs: number;
    conflictingPairs: number;
    bySeverity: Record<Severity, number>;
    byLayer: Record<CollisionLayer, number>;
  };
  mergeOrder: MergeOrderPlan;
}

export interface WorktreeIsolationAllocation {
  unitId: string;
  worktreePath: string;
  assignedPort: number;
  assignedVitePort: number;
  composeProjectName: string;
  envFilePath: string;
  envFileContent: string;
}

export interface IsolationPlan {
  basePort: number;
  allocations: WorktreeIsolationAllocation[];
  writtenFiles: string[];
}

export interface AgentInitResult {
  skillPath: string;
  hookPath: string;
  written: boolean;
  skillContent: string;
  hookContent: string;
}

/* ============================================================================
 * Cross-Module Functional Contracts (Locked for Parallel WU-1 .. WU-4)
 * ========================================================================== */

export type DiscoverTargetsFn = (options: ScanOptions) => Promise<TargetUnit[]>;

export type ComputePairDiffContextFn = (
  repoRoot: string,
  unitA: TargetUnit,
  unitB: TargetUnit,
) => Promise<PairDiffContext>;

export type AnalyzeTextualMergeTreeFn = (
  repoRoot: string,
  unitA: TargetUnit,
  unitB: TargetUnit,
  mergeBaseOid: string,
) => Promise<CollisionFinding[]>;

export type AnalyzeSemanticCollisionsFn = (
  ctx: PairDiffContext,
  lookupFile?: FileContentLookup,
) => Promise<CollisionFinding[]>;

export type AnalyzeInfraCollisionsFn = (
  ctx: PairDiffContext,
) => CollisionFinding[];

export type ComputeMergeOrderFn = (
  units: TargetUnit[],
  pairs: PairReport[],
) => MergeOrderPlan;
