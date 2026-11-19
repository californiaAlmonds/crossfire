import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execGit, resolveRepoRoot } from './exec.js';
import { isBinaryBuffer, toPosixPath } from '../utils.js';
import type {
  TargetUnit,
  ScanOptions,
  DiscoverTargetsFn,
  ComputePairDiffContextFn,
  PairDiffContext,
  ChangedFileDelta
} from '../types.js';

export const discoverTargets: DiscoverTargetsFn = async (options: ScanOptions): Promise<TargetUnit[]> => {
  const repoRoot = options.repoRoot;
  const units: TargetUnit[] = [];
  const seenIds = new Set<string>();

  // 1. Discover worktrees
  const wtRes = await execGit(['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  const lines = wtRes.stdout.split('\n');
  
  let currentWtPath = '';
  let currentHead = '';
  let currentBranch: string | null = null;
  let isBare = false;

  const processWorktree = async () => {
    if (!currentWtPath || isBare) return;

    let basenameOrBranch = currentBranch ? currentBranch : path.basename(currentWtPath);
    let id = `wt:${basenameOrBranch}`;
    let suffix = 1;
    while (seenIds.has(id)) {
      id = `wt:${basenameOrBranch}-${suffix++}`;
    }
    seenIds.add(id);

    let isDirty = false;
    let dirtyFileCount = 0;
    let effectiveOid = currentHead;

    if (!options.committedOnly) {
      const stRes = await execGit(['status', '--porcelain=v1', '-z', '-uall'], { cwd: currentWtPath });
      const parts = stRes.stdout.split('\0');
      let count = 0;
      for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (!entry) continue;
        const xy = entry.substring(0, 2);
        count++;
        if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
          i++; // skip old path in status output
        }
      }

      if (count > 0) {
        isDirty = true;
        dirtyFileCount = count;
        const tempIndex = path.join(os.tmpdir(), `crossfire-idx-${randomUUID()}`);
        
        try {
          const env = {
            ...process.env,
            GIT_INDEX_FILE: tempIndex,
            GIT_AUTHOR_NAME: 'crossfire',
            GIT_AUTHOR_EMAIL: 'crossfire@local',
            GIT_COMMITTER_NAME: 'crossfire',
            GIT_COMMITTER_EMAIL: 'crossfire@local'
          };
          
          await execGit(['read-tree', 'HEAD'], { cwd: currentWtPath, env, allowExitCodes: [0, 128] });
          await execGit(['add', '-A', '--', '.'], { cwd: currentWtPath, env });
          const writeTreeRes = await execGit(['write-tree'], { cwd: currentWtPath, env });
          const treeOid = writeTreeRes.stdout.trim();
          
          const args = ['commit-tree', treeOid, '-m', 'crossfire ephemeral snapshot'];
          if (currentHead && currentHead !== '0000000000000000000000000000000000000000') {
            args.push('-p', currentHead);
          }
          const commitRes = await execGit(args, { cwd: currentWtPath, env });
          effectiveOid = commitRes.stdout.trim();
        } finally {
          await fs.rm(tempIndex, { force: true }).catch(() => {});
        }
      }
    }

    units.push({
      id,
      kind: 'worktree',
      branch: currentBranch,
      worktreePath: currentWtPath,
      headOid: currentHead,
      effectiveOid,
      isDirty,
      dirtyFileCount,
      changedFilesByPeer: {}
    });
  };

  for (const line of lines) {
    if (!line.trim()) {
      await processWorktree();
      currentWtPath = '';
      currentHead = '';
      currentBranch = null;
      isBare = false;
      continue;
    }
    
    if (line.startsWith('worktree ')) {
      currentWtPath = line.substring(9).trim();
    } else if (line.startsWith('HEAD ')) {
      currentHead = line.substring(5).trim();
    } else if (line.startsWith('branch refs/heads/')) {
      currentBranch = line.substring(18).trim();
    } else if (line === 'bare') {
      isBare = true;
    } else if (line === 'detached') {
      currentBranch = null;
    }
  }
  await processWorktree();

  if (options.allBranches || options.branches?.length) {
    const refRes = await execGit(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/'], { cwd: repoRoot });
    for (const line of refRes.stdout.split('\n')) {
      const parts = line.trim().split(' ');
      const bName = parts[0];
      const bOid = parts[1];
      if (!bName || !bOid) continue;
      
      let shouldInclude = options.allBranches ? true : options.branches?.includes(bName);
      if (!shouldInclude) continue;
      
      const alreadyHasWt = units.some(u => u.kind === 'worktree' && u.branch === bName);
      if (alreadyHasWt) continue;
      
      let id = `branch:${bName}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        units.push({
          id,
          kind: 'branch',
          branch: bName,
          headOid: bOid,
          effectiveOid: bOid,
          isDirty: false,
          dirtyFileCount: 0,
          changedFilesByPeer: {}
        });
      }
    }
  }

  return units;
};

const blobCache = new Map<string, Promise<{ text: string | null; isBinary: boolean }>>();
const deltaCache = new Map<string, Promise<ChangedFileDelta[]>>();

export async function readBlobTextAtCommit(repoRoot: string, oid: string, posixPath: string): Promise<{ text: string | null; isBinary: boolean }> {
  const normPath = toPosixPath(posixPath);
  const cacheKey = `${repoRoot}|${oid}|${normPath}`;
  const cached = blobCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const res = await execGit(['cat-file', '-p', `${oid}:${normPath}`], { cwd: repoRoot, allowExitCodes: [0, 128] });
    if (res.exitCode === 128) {
      return { text: null, isBinary: false };
    }
    if (isBinaryBuffer(res.stdoutBuffer)) {
      return { text: null, isBinary: true };
    }
    return { text: res.stdoutBuffer.toString('utf8'), isBinary: false };
  })();

  if (blobCache.size > 4096) blobCache.clear();
  blobCache.set(cacheKey, promise);
  return promise;
}

export const computePairDiffContext: ComputePairDiffContextFn = async (repoRoot: string, unitA: TargetUnit, unitB: TargetUnit): Promise<PairDiffContext> => {
  const mbRes = await execGit(['merge-base', unitA.effectiveOid, unitB.effectiveOid], { cwd: repoRoot, allowExitCodes: [0, 1] });
  let mergeBaseOid = mbRes.stdout.trim();
  if (mbRes.exitCode === 1 || !mergeBaseOid) {
    mergeBaseOid = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  }

  const getDeltas = (unit: TargetUnit): Promise<ChangedFileDelta[]> => {
    const dKey = `${repoRoot}|${mergeBaseOid}|${unit.effectiveOid}`;
    const existing = deltaCache.get(dKey);
    if (existing) return existing;

    const p = (async (): Promise<ChangedFileDelta[]> => {
      const diffRes = await execGit(['diff', '--name-status', '-z', '-M', mergeBaseOid, unit.effectiveOid], { cwd: repoRoot });
      const parts = diffRes.stdout.split('\0');
      const entries: Array<{ pathStr: string; oldPathStr?: string; finalStatus: 'A' | 'M' | 'D' | 'R' }> = [];

      for (let i = 0; i < parts.length; i++) {
        const statusStr = parts[i];
        if (!statusStr) continue;
        const statusChar = statusStr[0] as 'A' | 'M' | 'D' | 'R' | 'C';

        let pathStr = '';
        let oldPathStr: string | undefined = undefined;

        if (statusChar === 'R' || statusChar === 'C') {
          const rawOld = parts[i + 1];
          const rawNew = parts[i + 2];
          if (!rawOld || !rawNew) break;
          oldPathStr = toPosixPath(rawOld);
          pathStr = toPosixPath(rawNew);
          i += 2;
        } else {
          const rawPath = parts[i + 1];
          if (!rawPath) break;
          pathStr = toPosixPath(rawPath);
          i += 1;
        }

        const finalStatus = statusChar === 'C' ? 'A' : statusChar;
        entries.push({ pathStr, oldPathStr, finalStatus: finalStatus as 'A' | 'M' | 'D' | 'R' });
      }

      return Promise.all(
        entries.map(async ({ pathStr, oldPathStr, finalStatus }) => {
          const [baseBlob, headBlob] = await Promise.all([
            finalStatus === 'A'
              ? Promise.resolve({ text: null, isBinary: false })
              : readBlobTextAtCommit(repoRoot, mergeBaseOid, oldPathStr || pathStr),
            finalStatus === 'D'
              ? Promise.resolve({ text: null, isBinary: false })
              : readBlobTextAtCommit(repoRoot, unit.effectiveOid, pathStr),
          ]);

          return {
            path: pathStr,
            status: finalStatus,
            oldPath: oldPathStr,
            baseContent: baseBlob.text,
            headContent: headBlob.text,
            isBinary: baseBlob.isBinary || headBlob.isBinary,
          };
        }),
      );
    })();

    if (deltaCache.size > 1024) deltaCache.clear();
    deltaCache.set(dKey, p);
    return p;
  };

  const [deltasA, deltasB] = await Promise.all([getDeltas(unitA), getDeltas(unitB)]);

  unitA.changedFilesByPeer[unitB.id] = deltasA.map(d => d.path);
  unitB.changedFilesByPeer[unitA.id] = deltasB.map(d => d.path);

  return {
    repoRoot,
    unitA,
    unitB,
    mergeBaseOid,
    deltasA,
    deltasB
  };
};
