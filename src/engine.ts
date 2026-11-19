import { performance } from 'node:perf_hooks';
import { analyzeInfraCollisions } from './analyzers/infra.js';
import { analyzeSemanticCollisions } from './analyzers/semantic.js';
import { resolveRepoRoot } from './git/exec.js';
import { analyzeTextualMergeTree } from './git/merge-tree.js';
import {
  computePairDiffContext,
  discoverTargets,
  readBlobTextAtCommit,
} from './git/snapshot.js';
import { computeMergeOrder } from './planner/merge-order.js';
import type {
  CollisionFinding,
  CollisionLayer,
  PairReport,
  ScanOptions,
  ScanReport,
  Severity,
  TargetUnit,
} from './types.js';
import { CROSSFIRE_VERSION, SEVERITY_WEIGHT, sortFindings } from './utils.js';

function matchesFocusTarget(unit: TargetUnit, focus: string): boolean {
  const normalized = focus.trim();
  if (!normalized) return true;
  return (
    unit.id === normalized ||
    unit.branch === normalized ||
    `wt:${normalized}` === unit.id ||
    `branch:${normalized}` === unit.id ||
    Boolean(unit.worktreePath && unit.worktreePath.endsWith(normalized))
  );
}

/**
 * Run the full Crossfire multi-layer collision scan across Git worktrees and branches.
 */
export async function scanRepository(
  rawOptions: ScanOptions,
): Promise<ScanReport> {
  const startedAt = performance.now();
  const repoRoot = await resolveRepoRoot(rawOptions.repoRoot);
  const options: ScanOptions = { ...rawOptions, repoRoot };

  const units = await discoverTargets(options);
  const pairs: PairReport[] = [];
  const allFindingsMap = new Map<string, CollisionFinding>();

  const lookupFile = async (
    oid: string,
    posixPath: string,
  ): Promise<string | null> => {
    const blob = await readBlobTextAtCommit(repoRoot, oid, posixPath);
    return blob.isBinary ? null : blob.text;
  };

  const pairJobs: Array<[TargetUnit, TargetUnit]> = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const unitA = units[i]!;
      const unitB = units[j]!;

      if (
        options.focusTarget &&
        !matchesFocusTarget(unitA, options.focusTarget) &&
        !matchesFocusTarget(unitB, options.focusTarget)
      ) {
        continue;
      }
      pairJobs.push([unitA, unitB]);
    }
  }

  const CONCURRENCY = 4;
  const pairResults: Array<PairReport | undefined> = new Array(pairJobs.length);
  let nextIdx = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIdx < pairJobs.length) {
      const jobIdx = nextIdx++;
      const [unitA, unitB] = pairJobs[jobIdx]!;

      const diffCtx = await computePairDiffContext(repoRoot, unitA, unitB);

      const [textualFindings, semanticFindings] = await Promise.all([
        analyzeTextualMergeTree(repoRoot, unitA, unitB, diffCtx.mergeBaseOid),
        analyzeSemanticCollisions(diffCtx, lookupFile),
      ]);
      const infraFindings = analyzeInfraCollisions(diffCtx);

      // Deduplicate per pair by deterministic finding ID
      const pairFindingMap = new Map<string, CollisionFinding>();
      for (const f of [
        ...textualFindings,
        ...semanticFindings,
        ...infraFindings,
      ]) {
        pairFindingMap.set(f.id, f);
        allFindingsMap.set(f.id, f);
      }

      const findings = sortFindings([...pairFindingMap.values()]);
      const counts: Record<Severity, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      let score = 0;
      for (const f of findings) {
        counts[f.severity]++;
        score += SEVERITY_WEIGHT[f.severity];
      }

      const status: PairReport['status'] =
        counts.critical > 0 || counts.high > 0
          ? 'conflict'
          : findings.length > 0
            ? 'warn'
            : 'clean';

      pairResults[jobIdx] = {
        unitA: unitA.id,
        unitB: unitB.id,
        mergeBaseOid: diffCtx.mergeBaseOid,
        score,
        status,
        counts,
        findings,
      };
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, Math.max(1, pairJobs.length)) },
      () => runWorker(),
    ),
  );

  for (const pr of pairResults) {
    if (pr) pairs.push(pr);
  }

  const findings = sortFindings([...allFindingsMap.values()]);
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const byLayer: Record<CollisionLayer, number> = {
    textual: 0,
    semantic: 0,
    migration: 0,
    infra: 0,
    dependency: 0,
  };

  for (const f of findings) {
    bySeverity[f.severity]++;
    byLayer[f.layer]++;
  }

  const mergeOrder = computeMergeOrder(units, pairs);
  const durationMs = Math.max(1, Math.round(performance.now() - startedAt));

  return {
    toolVersion: CROSSFIRE_VERSION,
    repoRoot,
    generatedAt: new Date().toISOString(),
    durationMs,
    units,
    pairs,
    findings,
    summary: {
      totalUnits: units.length,
      dirtyUnits: units.filter((u) => u.isDirty).length,
      totalPairs: pairs.length,
      conflictingPairs: pairs.filter((p) => p.status !== 'clean').length,
      bySeverity,
      byLayer,
    },
    mergeOrder,
  };
}
