import * as path from 'node:path';
import type {
  AnalyzeInfraCollisionsFn,
  ChangedFileDelta,
  CollisionFinding,
  PairDiffContext,
} from '../types.js';
import { makeFindingId, sortFindings, toPosixPath } from '../utils.js';

const MIGRATION_PATH_SUBSTRINGS = [
  'migrations/',
  'prisma/migrations/',
  'drizzle/',
  'supabase/migrations/',
  'alembic/versions/',
  'db/migrate/',
];

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'poetry.lock',
  'uv.lock',
  'Cargo.lock',
]);

function isMigrationPath(filePath: string): boolean {
  const norm = toPosixPath(filePath).toLowerCase();
  return MIGRATION_PATH_SUBSTRINGS.some(
    (sub) => norm.includes(`/${sub}`) || norm.startsWith(sub),
  );
}

function extractMigrationPrefix(filePath: string): string | null {
  const filename = toPosixPath(filePath).split('/').pop() ?? '';
  const match = filename.match(/^(\d+)/);
  return match && match[1] ? match[1] : null;
}

function extractTablesFromContent(
  filePath: string,
  content: string | null,
): Set<string> {
  const tables = new Set<string>();
  if (!content) return tables;
  const posix = toPosixPath(filePath).toLowerCase();

  if (posix.endsWith('.sql')) {
    const createTableRegex =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["'`]?[\w]+["'`]?\.)?["'`]?([\w]+)["'`]?/gi;
    const alterTableRegex =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:["'`]?[\w]+["'`]?\.)?["'`]?([\w]+)["'`]?/gi;
    const dropTableRegex =
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["'`]?[\w]+["'`]?\.)?["'`]?([\w]+)["'`]?/gi;
    const createIndexRegex =
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+[\s\S]*?\s+ON\s+(?:["'`]?[\w]+["'`]?\.)?["'`]?([\w]+)["'`]?/gi;

    let match: RegExpExecArray | null;
    while ((match = createTableRegex.exec(content)) !== null) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }
    while ((match = alterTableRegex.exec(content)) !== null) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }
    while ((match = dropTableRegex.exec(content)) !== null) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }
    while ((match = createIndexRegex.exec(content)) !== null) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }
  }

  if (posix.endsWith('.prisma')) {
    const prismaModelRegex = /model\s+([\w]+)\s*\{/gi;
    let match: RegExpExecArray | null;
    while ((match = prismaModelRegex.exec(content)) !== null) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }
  }

  if (posix.endsWith('.ts') || posix.endsWith('.js')) {
    const drizzleRegex =
      /(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*['"]([\w]+)['"]/gi;
    let match: RegExpExecArray | null;
    while ((match = drizzleRegex.exec(content)) !== null) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }
  }

  return tables;
}

interface PortFindingContext {
  port: number;
  file: string;
}

interface ComposeProjectContext {
  projectName: string;
  file: string;
}

function extractPortsAndCompose(
  filePath: string,
  content: string | null,
): { ports: PortFindingContext[]; composeProjects: ComposeProjectContext[] } {
  const ports: PortFindingContext[] = [];
  const composeProjects: ComposeProjectContext[] = [];
  if (!content) return { ports, composeProjects };

  const norm = toPosixPath(filePath).toLowerCase();
  const basename = path.posix.basename(norm);

  const isCandidateFile =
    basename.startsWith('.env') ||
    basename.includes('docker-compose') ||
    basename.includes('compose.') ||
    basename.startsWith('vite.config') ||
    basename.startsWith('next.config') ||
    basename === 'package.json';

  if (!isCandidateFile) {
    return { ports, composeProjects };
  }

  const addPort = (rawPort: string | number) => {
    const p = typeof rawPort === 'number' ? rawPort : parseInt(rawPort, 10);
    if (!isNaN(p) && p >= 1024 && p <= 65535) {
      ports.push({ port: p, file: filePath });
    }
  };

  // 1. Env style PORT=...
  const envPortRegex =
    /(?:PORT|VITE_PORT|APP_PORT|SERVER_PORT)\s*=\s*['"]?(\d+)['"]?/gi;
  let match: RegExpExecArray | null;
  while ((match = envPortRegex.exec(content)) !== null) {
    if (match[1]) addPort(match[1]);
  }

  // 2. Compose project name
  const composeProjectRegex =
    /COMPOSE_PROJECT_NAME\s*=\s*['"]?([^'"\s\r\n]+)['"]?/gi;
  while ((match = composeProjectRegex.exec(content)) !== null) {
    if (match[1]) {
      composeProjects.push({ projectName: match[1].trim(), file: filePath });
    }
  }

  // 3. Docker compose port mappings: "3000:3000" or - 8080:80
  const dockerPortRegex = /['"]?(\d{2,5}):\d+['"]?/g;
  while ((match = dockerPortRegex.exec(content)) !== null) {
    if (match[1]) addPort(match[1]);
  }

  // 4. CLI flags: --port 4000, --port=4000, -p 8080
  const cliPortRegex = /(?:--port(?:=|\s+)|-p\s+)['"]?(\d{2,5})['"]?/gi;
  while ((match = cliPortRegex.exec(content)) !== null) {
    if (match[1]) addPort(match[1]);
  }

  // 5. Config files: port: 3000
  const configPortRegex = /(?:port|listen)\s*:\s*(\d{2,5})/gi;
  while ((match = configPortRegex.exec(content)) !== null) {
    if (match[1]) addPort(match[1]);
  }

  return { ports, composeProjects };
}

interface DepChange {
  name: string;
  version: string;
  file: string;
}

function parsePackageJsonDeps(
  content: string | null,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!content) return map;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const sections = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ];
    for (const sec of sections) {
      const deps = parsed[sec];
      if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
        for (const [k, v] of Object.entries(deps as Record<string, unknown>)) {
          if (typeof v === 'string') {
            map.set(k, v);
          }
        }
      }
    }
  } catch {
    // ignore parse error
  }
  return map;
}

function parseTomlDeps(content: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!content) return map;

  const lines = content.split(/\r?\n/);
  let inDepSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.length === 0) continue;

    if (trimmed.startsWith('[')) {
      const lower = trimmed.toLowerCase();
      inDepSection =
        lower.includes('dependencies') ||
        lower.includes('dev-dependencies') ||
        lower.includes('build-dependencies');
      continue;
    }

    if (inDepSection) {
      // name = "1.0.0"
      const strMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*['"]([^'"]+)['"]/);
      if (strMatch && strMatch[1] && strMatch[2]) {
        map.set(strMatch[1], strMatch[2]);
        continue;
      }
      // name = { version = "1.0.0", ... }
      const objMatch = trimmed.match(
        /^([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*['"]([^'"]+)['"]/,
      );
      if (objMatch && objMatch[1] && objMatch[2]) {
        map.set(objMatch[1], objMatch[2]);
      }
    }
  }
  return map;
}

function extractDependencyChanges(delta: ChangedFileDelta): DepChange[] {
  const norm = toPosixPath(delta.path).toLowerCase();
  const basename = path.posix.basename(norm);
  const changes: DepChange[] = [];

  if (basename === 'package.json') {
    const baseMap = parsePackageJsonDeps(delta.baseContent);
    const headMap = parsePackageJsonDeps(delta.headContent);

    for (const [pkg, headVer] of headMap) {
      const baseVer = baseMap.get(pkg);
      if (baseVer !== headVer) {
        changes.push({ name: pkg, version: headVer, file: delta.path });
      }
    }
  } else if (basename === 'pyproject.toml' || basename === 'cargo.toml') {
    const baseMap = parseTomlDeps(delta.baseContent);
    const headMap = parseTomlDeps(delta.headContent);

    for (const [pkg, headVer] of headMap) {
      const baseVer = baseMap.get(pkg);
      if (baseVer !== headVer) {
        changes.push({ name: pkg, version: headVer, file: delta.path });
      }
    }
  }

  return changes;
}

export const analyzeInfraCollisions: AnalyzeInfraCollisionsFn = (
  ctx: PairDiffContext,
): CollisionFinding[] => {
  const findings: CollisionFinding[] = [];

  // ==========================================================================
  // Rule 1: MIGRATION_SEQUENCE_CLASH (migration / critical)
  // ==========================================================================
  const addedMigrationsA = ctx.deltasA.filter(
    (d) => d.status === 'A' && isMigrationPath(d.path),
  );
  const addedMigrationsB = ctx.deltasB.filter(
    (d) => d.status === 'A' && isMigrationPath(d.path),
  );

  for (const fileA of addedMigrationsA) {
    const prefixA = extractMigrationPrefix(fileA.path);
    if (!prefixA) continue;

    for (const fileB of addedMigrationsB) {
      if (fileA.path === fileB.path) continue;
      const prefixB = extractMigrationPrefix(fileB.path);
      if (prefixB && prefixA === prefixB) {
        const filenameA = path.posix.basename(fileA.path);
        const filenameB = path.posix.basename(fileB.path);
        const findingId = makeFindingId({
          layer: 'migration',
          rule: 'MIGRATION_SEQUENCE_CLASH',
          unitA: ctx.unitA.id,
          unitB: ctx.unitB.id,
          files: [fileA.path, fileB.path],
          detail: prefixA,
        });

        findings.push({
          id: findingId,
          layer: 'migration',
          rule: 'MIGRATION_SEQUENCE_CLASH',
          severity: 'critical',
          unitA: ctx.unitA.id,
          unitB: ctx.unitB.id,
          files: [fileA.path, fileB.path],
          summary: `Migration sequence clash: both units add migrations with prefix '${prefixA}' (${filenameA} vs ${filenameB})`,
          evidence: `Unit ${ctx.unitA.id} added ${fileA.path}\nUnit ${ctx.unitB.id} added ${fileB.path}`,
          remediation: `Re-sequence one of the migration files to a later sequence number or timestamp after merging the other.`,
        });
      }
    }
  }

  // ==========================================================================
  // Rule 2: CONCURRENT_SCHEMA_TABLE_DDL (migration / high)
  // ==========================================================================
  const tablesA = new Map<string, Set<string>>();
  for (const delta of ctx.deltasA) {
    if (delta.status === 'D') continue;
    const extracted = extractTablesFromContent(delta.path, delta.headContent);
    for (const tbl of extracted) {
      const set = tablesA.get(tbl) ?? new Set();
      set.add(delta.path);
      tablesA.set(tbl, set);
    }
  }

  const tablesB = new Map<string, Set<string>>();
  for (const delta of ctx.deltasB) {
    if (delta.status === 'D') continue;
    const extracted = extractTablesFromContent(delta.path, delta.headContent);
    for (const tbl of extracted) {
      const set = tablesB.get(tbl) ?? new Set();
      set.add(delta.path);
      tablesB.set(tbl, set);
    }
  }

  // Check table overlap
  const sharedTables = new Set<string>();
  for (const tbl of tablesA.keys()) {
    if (tablesB.has(tbl)) {
      sharedTables.add(tbl);
    }
  }

  for (const tbl of sharedTables) {
    const filesA = Array.from(tablesA.get(tbl) ?? []);
    const filesB = Array.from(tablesB.get(tbl) ?? []);
    const allFiles = Array.from(new Set([...filesA, ...filesB]));

    const findingId = makeFindingId({
      layer: 'migration',
      rule: 'CONCURRENT_SCHEMA_TABLE_DDL',
      unitA: ctx.unitA.id,
      unitB: ctx.unitB.id,
      files: allFiles,
      detail: tbl,
    });

    findings.push({
      id: findingId,
      layer: 'migration',
      rule: 'CONCURRENT_SCHEMA_TABLE_DDL',
      severity: 'high',
      unitA: ctx.unitA.id,
      unitB: ctx.unitB.id,
      files: allFiles,
      summary: `Concurrent schema modification on table/model '${tbl}' across both units`,
      evidence: `Unit ${ctx.unitA.id} modifies table '${tbl}' in ${filesA.join(', ')}\nUnit ${ctx.unitB.id} modifies table '${tbl}' in ${filesB.join(', ')}`,
      remediation: `Coordinate database schema migration for '${tbl}'. Apply one migration first, rebase the second branch, and regenerate schema types.`,
    });
  }

  // Also check if both units modified schema.prisma without parsed table collision
  const schemaPrismaA = ctx.deltasA.find(
    (d) =>
      d.status !== 'D' &&
      toPosixPath(d.path).toLowerCase().endsWith('schema.prisma'),
  );
  const schemaPrismaB = ctx.deltasB.find(
    (d) =>
      d.status !== 'D' &&
      toPosixPath(d.path).toLowerCase().endsWith('schema.prisma'),
  );

  if (schemaPrismaA && schemaPrismaB && sharedTables.size === 0) {
    const prismaFiles = Array.from(
      new Set([schemaPrismaA.path, schemaPrismaB.path]),
    );
    const findingId = makeFindingId({
      layer: 'migration',
      rule: 'CONCURRENT_SCHEMA_TABLE_DDL',
      unitA: ctx.unitA.id,
      unitB: ctx.unitB.id,
      files: prismaFiles,
      detail: 'schema.prisma',
    });

    findings.push({
      id: findingId,
      layer: 'migration',
      rule: 'CONCURRENT_SCHEMA_TABLE_DDL',
      severity: 'high',
      unitA: ctx.unitA.id,
      unitB: ctx.unitB.id,
      files: prismaFiles,
      summary: `Concurrent schema modification on Prisma schema across both units`,
      evidence: `Both units modified '${prismaFiles.join(', ')}'.`,
      remediation: `Rebase one unit on the other and run 'prisma migrate dev' or 'prisma generate' to reconcile schema changes.`,
    });
  }

  // ==========================================================================
  // Rule 3: PORT_BINDING_CLASH (infra / high)
  // ==========================================================================
  const portsA: PortFindingContext[] = [];
  const composeProjectsA: ComposeProjectContext[] = [];
  for (const delta of ctx.deltasA) {
    if (delta.status === 'D') continue;
    const res = extractPortsAndCompose(delta.path, delta.headContent);
    portsA.push(...res.ports);
    composeProjectsA.push(...res.composeProjects);
  }

  const portsB: PortFindingContext[] = [];
  const composeProjectsB: ComposeProjectContext[] = [];
  for (const delta of ctx.deltasB) {
    if (delta.status === 'D') continue;
    const res = extractPortsAndCompose(delta.path, delta.headContent);
    portsB.push(...res.ports);
    composeProjectsB.push(...res.composeProjects);
  }

  // Check port binding collisions
  const seenPortClashes = new Set<number>();
  for (const pA of portsA) {
    for (const pB of portsB) {
      if (pA.port === pB.port && !seenPortClashes.has(pA.port)) {
        seenPortClashes.add(pA.port);
        const files = Array.from(new Set([pA.file, pB.file]));
        const findingId = makeFindingId({
          layer: 'infra',
          rule: 'PORT_BINDING_CLASH',
          unitA: ctx.unitA.id,
          unitB: ctx.unitB.id,
          files,
          detail: `port-${pA.port}`,
        });

        findings.push({
          id: findingId,
          layer: 'infra',
          rule: 'PORT_BINDING_CLASH',
          severity: 'high',
          unitA: ctx.unitA.id,
          unitB: ctx.unitB.id,
          files,
          summary: `Port binding clash: both units bind host port ${pA.port}`,
          evidence: `Unit ${ctx.unitA.id} binds port ${pA.port} in ${pA.file}\nUnit ${ctx.unitB.id} binds port ${pA.port} in ${pB.file}`,
          remediation: `Use 'crossfire isolate' or reassign port ${pA.port} in one of the units to prevent runtime EADDRINUSE collisions.`,
        });
      }
    }
  }

  // Check compose project name clash
  const seenComposeClashes = new Set<string>();
  for (const cA of composeProjectsA) {
    for (const cB of composeProjectsB) {
      if (
        cA.projectName === cB.projectName &&
        !seenComposeClashes.has(cA.projectName)
      ) {
        seenComposeClashes.add(cA.projectName);
        const files = Array.from(new Set([cA.file, cB.file]));
        const findingId = makeFindingId({
          layer: 'infra',
          rule: 'PORT_BINDING_CLASH',
          unitA: ctx.unitA.id,
          unitB: ctx.unitB.id,
          files,
          detail: `compose-${cA.projectName}`,
        });

        findings.push({
          id: findingId,
          layer: 'infra',
          rule: 'PORT_BINDING_CLASH',
          severity: 'high',
          unitA: ctx.unitA.id,
          unitB: ctx.unitB.id,
          files,
          summary: `Identical COMPOSE_PROJECT_NAME '${cA.projectName}' across both units`,
          evidence: `Unit ${ctx.unitA.id} sets COMPOSE_PROJECT_NAME='${cA.projectName}' in ${cA.file}\nUnit ${ctx.unitB.id} sets COMPOSE_PROJECT_NAME='${cB.projectName}' in ${cB.file}`,
          remediation: `Isolate container namespaces by setting a unique COMPOSE_PROJECT_NAME per worktree via 'crossfire isolate'.`,
        });
      }
    }
  }

  // ==========================================================================
  // Rule 4: DEPENDENCY_VERSION_CONFLICT (dependency / high)
  // ==========================================================================
  const depChangesA = new Map<string, DepChange>();
  for (const delta of ctx.deltasA) {
    if (delta.status === 'D') continue;
    for (const chg of extractDependencyChanges(delta)) {
      depChangesA.set(chg.name, chg);
    }
  }

  const depChangesB = new Map<string, DepChange>();
  for (const delta of ctx.deltasB) {
    if (delta.status === 'D') continue;
    for (const chg of extractDependencyChanges(delta)) {
      depChangesB.set(chg.name, chg);
    }
  }

  for (const [pkg, chgA] of depChangesA) {
    const chgB = depChangesB.get(pkg);
    if (chgB && chgA.version !== chgB.version) {
      const files = Array.from(new Set([chgA.file, chgB.file]));
      const findingId = makeFindingId({
        layer: 'dependency',
        rule: 'DEPENDENCY_VERSION_CONFLICT',
        unitA: ctx.unitA.id,
        unitB: ctx.unitB.id,
        files,
        detail: `${pkg}:${chgA.version}<->${chgB.version}`,
      });

      findings.push({
        id: findingId,
        layer: 'dependency',
        rule: 'DEPENDENCY_VERSION_CONFLICT',
        severity: 'high',
        unitA: ctx.unitA.id,
        unitB: ctx.unitB.id,
        files,
        summary: `Dependency version conflict for '${pkg}': '${chgA.version}' vs '${chgB.version}'`,
        evidence: `Unit ${ctx.unitA.id} sets ${pkg}@${chgA.version} in ${chgA.file}\nUnit ${ctx.unitB.id} sets ${pkg}@${chgB.version} in ${chgB.file}`,
        remediation: `Align dependency version for '${pkg}' between both units before merging to prevent duplicate bundles or runtime incompatibilities.`,
      });
    }
  }

  // ==========================================================================
  // Rule 5: LOCKFILE_CHURN_RISK (dependency / medium)
  // ==========================================================================
  const lockfilesA = ctx.deltasA.filter((d) => {
    const basename = path.posix.basename(toPosixPath(d.path));
    return d.status !== 'D' && LOCKFILE_NAMES.has(basename);
  });
  const lockfilesB = ctx.deltasB.filter((d) => {
    const basename = path.posix.basename(toPosixPath(d.path));
    return d.status !== 'D' && LOCKFILE_NAMES.has(basename);
  });

  for (const lA of lockfilesA) {
    const baseA = path.posix.basename(toPosixPath(lA.path));
    for (const lB of lockfilesB) {
      const baseB = path.posix.basename(toPosixPath(lB.path));
      if (lA.path === lB.path || baseA === baseB) {
        const files = Array.from(new Set([lA.path, lB.path]));
        const findingId = makeFindingId({
          layer: 'dependency',
          rule: 'LOCKFILE_CHURN_RISK',
          unitA: ctx.unitA.id,
          unitB: ctx.unitB.id,
          files,
          detail: baseA,
        });

        findings.push({
          id: findingId,
          layer: 'dependency',
          rule: 'LOCKFILE_CHURN_RISK',
          severity: 'medium',
          unitA: ctx.unitA.id,
          unitB: ctx.unitB.id,
          files,
          summary: `Concurrent lockfile churn risk on '${baseA}'`,
          evidence: `Both units modified lockfile '${lA.path}'. Git merge markers in generated lockfiles often cause corruption.`,
          remediation: `Merge code changes first, then run your package manager install command to regenerate '${baseA}' cleanly.`,
        });
      }
    }
  }

  return sortFindings(findings);
};
