import { execGit } from './exec.js';
import { makeFindingId, sortFindings, toPosixPath } from '../utils.js';
import type {
  AnalyzeTextualMergeTreeFn,
  CollisionFinding,
  TargetUnit
} from '../types.js';

export const analyzeTextualMergeTree: AnalyzeTextualMergeTreeFn = async (
  repoRoot: string,
  unitA: TargetUnit,
  unitB: TargetUnit,
  mergeBaseOid: string
): Promise<CollisionFinding[]> => {
  const args = [
    'merge-tree',
    '--write-tree',
    '--messages',
    '--name-only'
  ];

  if (mergeBaseOid && mergeBaseOid !== '4b825dc642cb6eb9a060e54bf8d69288fbee4904') {
    args.push(`--merge-base=${mergeBaseOid}`);
  }

  args.push(unitA.effectiveOid, unitB.effectiveOid);

  const res = await execGit(args, {
    cwd: repoRoot,
    allowExitCodes: [0, 1]
  });

  if (res.exitCode === 0) {
    return [];
  }

  const findings: CollisionFinding[] = [];
  const lines = res.stdout.split('\n');

  for (const line of lines) {
    const match = line.match(/^CONFLICT \(([^)]+)\):\s+(.*)$/);
    if (!match) continue;

    const type = match[1];
    const message = match[2];
    if (!type || !message) continue;
    let rule = 'TEXT_CONFLICT';
    let files: string[] = [];

    if (type === 'content') {
      rule = 'TEXT_CONTENT_CONFLICT';
      const fileMatch = message.match(/Merge conflict in (.*)$/);
      if (fileMatch?.[1]) files.push(fileMatch[1]);
    } else if (type === 'modify/delete') {
      rule = 'TEXT_MODIFY_DELETE_CONFLICT';
      const fileMatch = message.match(/^(.*?) deleted in/);
      if (fileMatch?.[1]) files.push(fileMatch[1]);
    } else if (type.includes('rename')) {
      rule = 'TEXT_RENAME_CONFLICT';
      const fileMatch = message.match(/Rename (.*?)\s*->\s*(.*?)\s+in/);
      if (fileMatch?.[1] && fileMatch[2]) {
        files.push(fileMatch[1], fileMatch[2]);
      } else {
        const fallback = message.match(/^(.*?)\s+renamed/);
        if (fallback?.[1]) files.push(fallback[1]);
      }
    } else if (type === 'add/add') {
      rule = 'TEXT_ADD_ADD_CONFLICT';
      const fileMatch = message.match(/Merge conflict in (.*)$/);
      if (fileMatch?.[1]) files.push(fileMatch[1]);
    } else {
      rule = `TEXT_${type.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_CONFLICT`;
      // best effort file extraction
      const fallback = message.match(/in (.*)$/);
      if (fallback?.[1]) files.push(fallback[1]);
    }

    if (files.length === 0) {
      // Fallback: try to see if any word looks like a path
      const words = message.split(' ');
      for (const w of words) {
        if (w.includes('/')) files.push(w);
      }
    }

    files = files.map(toPosixPath);

    findings.push({
      id: makeFindingId({
        layer: 'textual',
        rule,
        unitA: unitA.id,
        unitB: unitB.id,
        files,
        detail: message
      }),
      layer: 'textual',
      rule,
      severity: 'critical',
      unitA: unitA.id,
      unitB: unitB.id,
      files,
      summary: `Git textual merge conflict (${type}) between ${unitA.id} and ${unitB.id}`,
      evidence: line,
      remediation: 'Resolve textual conflicts manually via standard git merge or rebase workflows.'
    });
  }

  return sortFindings(findings);
};
