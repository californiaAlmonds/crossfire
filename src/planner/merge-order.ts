import type {
  ComputeMergeOrderFn,
  MergeOrderPlan,
  PairReport,
  TargetUnit,
} from '../types.js';

function pairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join('<->');
}

function isPrimaryBranch(unit: TargetUnit): boolean {
  const b = (unit.branch ?? '').toLowerCase();
  const id = unit.id.toLowerCase();
  return (
    b === 'main' ||
    b === 'master' ||
    id === 'wt:main' ||
    id === 'wt:master' ||
    id === 'branch:main' ||
    id === 'branch:master'
  );
}

function getChangedFilesCount(unit: TargetUnit): number {
  const allFiles = new Set<string>();
  if (unit.changedFilesByPeer) {
    for (const files of Object.values(unit.changedFilesByPeer)) {
      if (Array.isArray(files)) {
        for (const f of files) allFiles.add(f);
      }
    }
  }
  return allFiles.size;
}

export const computeMergeOrder: ComputeMergeOrderFn = (
  units: TargetUnit[],
  pairs: PairReport[],
): MergeOrderPlan => {
  if (units.length === 0) {
    return {
      recommendedOrder: [],
      parallelWaves: [],
      rationale: {},
    };
  }

  if (units.length === 1) {
    const single = units[0]!;
    return {
      recommendedOrder: [single.id],
      parallelWaves: [[single.id]],
      rationale: {
        [single.id]: 'Single unit; no peer collisions.',
      },
    };
  }

  // Build pair lookup map
  const pairMap = new Map<string, PairReport>();
  for (const pair of pairs) {
    pairMap.set(pairKey(pair.unitA, pair.unitB), pair);
  }

  const getPair = (idA: string, idB: string): PairReport | undefined => {
    return pairMap.get(pairKey(idA, idB));
  };

  const getScore = (idA: string, idB: string): number => {
    return getPair(idA, idB)?.score ?? 0;
  };

  const unitMap = new Map<string, TargetUnit>();
  for (const u of units) {
    unitMap.set(u.id, u);
  }

  // Global total collision scores
  const globalScores = new Map<string, number>();
  for (const u of units) {
    let sum = 0;
    for (const other of units) {
      if (other.id !== u.id) {
        sum += getScore(u.id, other.id);
      }
    }
    globalScores.set(u.id, sum);
  }

  // Recommended Merge Order:
  // Iteratively select the next remaining unit minimizing total collision score
  // with remaining unmerged units.
  // Tie-breaking:
  // 1. clean units first (globalScore === 0)
  // 2. primary/main branch first
  // 3. fewer changed files
  // 4. alphabetical id
  const remaining = new Set(units.map((u) => u.id));
  const recommendedOrder: string[] = [];

  while (remaining.size > 0) {
    let bestUnitId: string | null = null;
    let bestFriction = Infinity;

    for (const candId of remaining) {
      // Calculate friction with currently remaining peers
      let frictionWithRemaining = 0;
      for (const otherId of remaining) {
        if (otherId !== candId) {
          frictionWithRemaining += getScore(candId, otherId);
        }
      }

      if (bestUnitId === null) {
        bestUnitId = candId;
        bestFriction = frictionWithRemaining;
        continue;
      }

      // Comparison logic
      const candUnit = unitMap.get(candId)!;
      const bestUnit = unitMap.get(bestUnitId)!;

      // a) friction with remaining
      if (frictionWithRemaining !== bestFriction) {
        if (frictionWithRemaining < bestFriction) {
          bestUnitId = candId;
          bestFriction = frictionWithRemaining;
        }
        continue;
      }

      // b) clean units first (global score === 0)
      const candIsClean = (globalScores.get(candId) ?? 0) === 0;
      const bestIsClean = (globalScores.get(bestUnitId) ?? 0) === 0;
      if (candIsClean !== bestIsClean) {
        if (candIsClean) {
          bestUnitId = candId;
          bestFriction = frictionWithRemaining;
        }
        continue;
      }

      // c) primary/main branch first
      const candIsPrimary = isPrimaryBranch(candUnit);
      const bestIsPrimary = isPrimaryBranch(bestUnit);
      if (candIsPrimary !== bestIsPrimary) {
        if (candIsPrimary) {
          bestUnitId = candId;
          bestFriction = frictionWithRemaining;
        }
        continue;
      }

      // d) fewer changed files
      const candFiles = getChangedFilesCount(candUnit);
      const bestFiles = getChangedFilesCount(bestUnit);
      if (candFiles !== bestFiles) {
        if (candFiles < bestFiles) {
          bestUnitId = candId;
          bestFriction = frictionWithRemaining;
        }
        continue;
      }

      // e) alphabetical id
      if (candId.localeCompare(bestUnitId) < 0) {
        bestUnitId = candId;
        bestFriction = frictionWithRemaining;
      }
    }

    if (bestUnitId) {
      recommendedOrder.push(bestUnitId);
      remaining.delete(bestUnitId);
    } else {
      break;
    }
  }

  // Parallel Waves:
  // Greedy graph coloring on recommendedOrder - place a unit into the earliest wave
  // where it has score === 0 (status === 'clean') with every unit already in that wave.
  const waves: string[][] = [];
  const unitWaveIndex = new Map<string, number>();

  for (const unitId of recommendedOrder) {
    let placedWaveIdx = -1;

    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w]!;
      const hasConflict = wave.some((peerId) => getScore(unitId, peerId) > 0);
      if (!hasConflict) {
        wave.push(unitId);
        placedWaveIdx = w;
        break;
      }
    }

    if (placedWaveIdx === -1) {
      waves.push([unitId]);
      placedWaveIdx = waves.length - 1;
    }

    unitWaveIndex.set(unitId, placedWaveIdx);
  }

  const finalOrder = waves.flat();

  // Rationale generation
  const rationale: Record<string, string> = {};
  for (const unitId of finalOrder) {
    const waveNum = (unitWaveIndex.get(unitId) ?? 0) + 1;
    const globalScore = globalScores.get(unitId) ?? 0;

    if (globalScore === 0) {
      rationale[unitId] = `Zero collisions with all peers; safe to merge in Wave ${waveNum}.`;
      continue;
    }

    // Find highest friction partner
    let maxPeer: string | null = null;
    let maxScore = 0;
    let topRule: string | null = null;

    for (const other of units) {
      if (other.id === unitId) continue;
      const pair = getPair(unitId, other.id);
      if (pair && pair.score > maxScore) {
        maxScore = pair.score;
        maxPeer = other.id;
        topRule = pair.findings[0]?.rule ?? null;
      }
    }

    if (maxPeer && maxScore > 0) {
      const ruleDesc = topRule ? `: ${topRule}` : '';
      rationale[unitId] = `Collides with ${maxPeer} (score ${maxScore}${ruleDesc}); scheduled in Wave ${waveNum}.`;
    } else {
      rationale[unitId] = `Total friction score ${globalScore}; scheduled in Wave ${waveNum}.`;
    }
  }

  return {
    recommendedOrder: finalOrder,
    parallelWaves: waves,
    rationale,
  };
};
