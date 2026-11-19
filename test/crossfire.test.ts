import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  scanRepository,
  runCli,
  renderHtmlReport,
  renderSarifReport,
  execGit,
} from '../src/index.js';

interface TestRepoContext {
  rootDir: string;
  repoDir: string;
}

async function createTestRepo(name: string): Promise<TestRepoContext> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), `crossfire-${name}-`));
  const repoDir = path.join(rootDir, 'repo');
  await fs.mkdir(repoDir, { recursive: true });

  await execGit(['init'], { cwd: repoDir });
  await execGit(['checkout', '-b', 'main'], { cwd: repoDir, allowExitCodes: [0, 1] });
  await execGit(['config', 'user.name', 'Crossfire Test'], { cwd: repoDir });
  await execGit(['config', 'user.email', 'crossfire@test.local'], { cwd: repoDir });
  await execGit(['config', 'commit.gpgSign', 'false'], { cwd: repoDir });

  return { rootDir, repoDir };
}

async function cleanupTestRepo(ctx: TestRepoContext): Promise<void> {
  try {
    await execGit(['worktree', 'prune'], { cwd: ctx.repoDir, allowExitCodes: [0, 1, 128] });
  } catch {}
  try {
    await fs.rm(ctx.rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch {}
}

describe('Crossfire Collision Radar Test Suite', () => {
  test('1. Zero-Conflict Semantic Arity Break Across Disjoint Dirty Worktrees', async (t) => {
    const ctx = await createTestRepo('semantic-arity');
    t.after(async () => {
      await cleanupTestRepo(ctx);
    });

    const { repoDir, rootDir } = ctx;

    // 1. Initial commit on main with src/auth.ts and src/billing.ts
    const srcDir = path.join(repoDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'auth.ts'),
      `export function verifySession(token: string) {\n  return token.length > 0;\n}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(srcDir, 'billing.ts'),
      `export const defaultCurrency = 'USD';\n`,
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Initial commit on main'], { cwd: repoDir });

    // 2. Create two worktree checkouts
    const wtAuth = path.join(rootDir, 'wt-auth');
    const wtCheckout = path.join(rootDir, 'wt-checkout');
    await execGit(['worktree', 'add', '-b', 'feat-auth', wtAuth], { cwd: repoDir });
    await execGit(['worktree', 'add', '-b', 'feat-checkout', wtCheckout], { cwd: repoDir });

    // 3. In wt-auth (UNCOMMITTED dirty edit): require 2 args
    await fs.writeFile(
      path.join(wtAuth, 'src', 'auth.ts'),
      `export function verifySession(token: string, tenantId: string) {\n  return token.length > 0 && tenantId.length > 0;\n}\n`,
      'utf8',
    );

    // 4. In wt-checkout (UNCOMMITTED dirty edit in completely different file src/checkout.ts!)
    await fs.writeFile(
      path.join(wtCheckout, 'src', 'checkout.ts'),
      `import { verifySession } from './auth.js';\nexport const ok = verifySession('tok_123');\n`,
      'utf8',
    );

    // Capture porcelain status before scan
    const beforeStatusAuth = (await execGit(['status', '--porcelain'], { cwd: wtAuth })).stdout;
    const beforeStatusCheckout = (await execGit(['status', '--porcelain'], { cwd: wtCheckout })).stdout;
    const beforeStatusMain = (await execGit(['status', '--porcelain'], { cwd: repoDir })).stdout;

    // Run Crossfire scan
    const report = await scanRepository({ repoRoot: repoDir });

    // 5. Assertions:
    // a) Assert 0 textual conflicts (Git merge-tree passes cleanly because files are disjoint!)
    const textualConflicts = report.findings.filter((f) => f.layer === 'textual');
    assert.equal(
      textualConflicts.length,
      0,
      'Disjoint dirty worktrees must produce 0 textual conflicts',
    );

    // b) Assert SIGNATURE_ARITY_BREAK (layer: semantic, severity: critical) IS caught!
    const arityFinding = report.findings.find((f) => f.rule === 'SIGNATURE_ARITY_BREAK');
    assert.ok(
      arityFinding,
      'Must detect SIGNATURE_ARITY_BREAK across disjoint dirty worktrees',
    );
    assert.equal(arityFinding.layer, 'semantic');
    assert.equal(arityFinding.severity, 'critical');
    assert.ok(
      arityFinding.evidence.includes('verifySession') || arityFinding.summary.includes('verifySession'),
    );

    // c) Assert read-only safety invariant: git status --porcelain is 100% unchanged
    const afterStatusAuth = (await execGit(['status', '--porcelain'], { cwd: wtAuth })).stdout;
    const afterStatusCheckout = (await execGit(['status', '--porcelain'], { cwd: wtCheckout })).stdout;
    const afterStatusMain = (await execGit(['status', '--porcelain'], { cwd: repoDir })).stdout;

    assert.equal(afterStatusAuth, beforeStatusAuth, 'wt-auth working tree was modified by scan!');
    assert.equal(afterStatusCheckout, beforeStatusCheckout, 'wt-checkout working tree was modified by scan!');
    assert.equal(afterStatusMain, beforeStatusMain, 'main working tree was modified by scan!');

    // Clean up worktrees explicitly
    await execGit(['worktree', 'remove', '--force', wtAuth], { cwd: repoDir });
    await execGit(['worktree', 'remove', '--force', wtCheckout], { cwd: repoDir });
  });

  test('2. Deleted/Renamed Export & Type Contract Drift with Comment/String Immunity', async (t) => {
    const ctx = await createTestRepo('semantic-drift');
    t.after(async () => {
      await cleanupTestRepo(ctx);
    });

    const { repoDir } = ctx;

    // Base commit on main: export BOTH getUser AND legacyHelper (so legacyHelper is a real tracked export!)
    const srcDir = path.join(repoDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'user.ts'),
      `export function getUser(id: string) {\n  return { id };\n}\n\nexport function legacyHelper(flag: string) {\n  return flag;\n}\n\nexport interface UserProfile {\n  id: string;\n  name: string;\n}\n`,
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Initial user contract'], { cwd: repoDir });

    // Branch A: Renames getUser to fetchUser, deletes legacyHelper, and alters UserProfile interface
    await execGit(['checkout', '-b', 'branch-a'], { cwd: repoDir });
    await fs.writeFile(
      path.join(srcDir, 'user.ts'),
      `export function fetchUser(id: string) {\n  return { id };\n}\n\nexport interface UserProfile {\n  id: string;\n  name: string;\n  email: string;\n}\n`,
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Rename getUser, remove legacyHelper, add email to UserProfile'], { cwd: repoDir });

    // Branch B: Consumes old getUser AFTER a template literal with ${...}, while mentioning deleted legacyHelper ONLY inside comments/strings/templates!
    await execGit(['checkout', 'main'], { cwd: repoDir });
    await execGit(['checkout', '-b', 'branch-b'], { cwd: repoDir });
    await fs.writeFile(
      path.join(srcDir, 'client.ts'),
      [
        `import { getUser, UserProfile } from './user.js';`,
        `export function renderUser(profile: UserProfile) {`,
        `  // legacyHelper('line-comment');`,
        `  /* legacyHelper('block-comment'); */`,
        `  const logMsg = "legacyHelper('double-quoted-string')";`,
        `  const tpl = \`prefix-\${profile.id}-legacyHelper('inside-template-text')\`;`,
        `  return { tpl, logMsg, user: getUser(profile.id) };`,
        `}`,
        '',
      ].join('\n'),
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Add client consuming user.ts with comments and template expressions'], { cwd: repoDir });

    const report = await scanRepository({
      repoRoot: repoDir,
      branches: ['branch-a', 'branch-b'],
    });

    // Verify renamed/deleted export detected even AFTER `${profile.id}` template interpolation
    const renameOrDelete = report.findings.find(
      (f) =>
        (f.rule === 'RENAMED_EXPORT_STALE_REF' || f.rule === 'DELETED_EXPORT_REFERENCED') &&
        (f.summary.includes('getUser') || f.evidence.includes('getUser')),
    );
    assert.ok(
      renameOrDelete,
      'Must detect RENAMED_EXPORT_STALE_REF or DELETED_EXPORT_REFERENCED for getUser after template interpolation',
    );
    assert.equal(renameOrDelete.layer, 'semantic');

    // Verify type contract drift detected
    const typeDrift = report.findings.find((f) => f.rule === 'TYPE_CONTRACT_DRIFT');
    assert.ok(typeDrift, 'Must detect TYPE_CONTRACT_DRIFT for UserProfile');
    assert.equal(typeDrift.layer, 'semantic');
    assert.equal(typeDrift.severity, 'high');

    // Verify TRUE comment, string, and template-text immunity: legacyHelper WAS exported on main and deleted on branch-a,
    // so if comments/strings/templates leaked into symbol references, legacyHelper would trigger DELETED_EXPORT_REFERENCED!
    const falsePositive = report.findings.find(
      (f) => f.summary.includes('legacyHelper') || f.evidence.includes('legacyHelper'),
    );
    assert.equal(
      falsePositive,
      undefined,
      'Deleted export mentioned only in comments/strings/template-text must NOT trigger false positive findings',
    );
  });

  test('3. Migration Sequence Clash, Concurrent Schema DDL, Port Clash & Dependency Conflict', async (t) => {
    const ctx = await createTestRepo('infra-collision');
    t.after(async () => {
      await cleanupTestRepo(ctx);
    });

    const { repoDir } = ctx;

    // Base commit with package.json
    await fs.writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { zod: '^3.20.0' } }, null, 2),
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Base repo setup'], { cwd: repoDir });

    // Branch A: Migration 0007_users.sql, .env PORT=4100, zod ^3.23.0
    await execGit(['checkout', '-b', 'branch-a'], { cwd: repoDir });
    await fs.mkdir(path.join(repoDir, 'migrations'), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, 'migrations', '0007_users.sql'),
      `ALTER TABLE users ADD COLUMN role TEXT;\n`,
      'utf8',
    );
    await fs.writeFile(path.join(repoDir, '.env'), `PORT=4100\n`, 'utf8');
    await fs.writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { zod: '^3.23.0' } }, null, 2),
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Branch A changes'], { cwd: repoDir });

    // Branch B: Migration 0007_audit.sql, .env.dev PORT=4100, zod ^4.0.0
    await execGit(['checkout', 'main'], { cwd: repoDir });
    await execGit(['checkout', '-b', 'branch-b'], { cwd: repoDir });
    await fs.mkdir(path.join(repoDir, 'migrations'), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, 'migrations', '0007_audit.sql'),
      `ALTER TABLE users ADD COLUMN last_login TIMESTAMP;\n`,
      'utf8',
    );
    await fs.writeFile(path.join(repoDir, '.env.dev'), `PORT=4100\n`, 'utf8');
    await fs.writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { zod: '^4.0.0' } }, null, 2),
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Branch B changes'], { cwd: repoDir });

    const report = await scanRepository({
      repoRoot: repoDir,
      branches: ['branch-a', 'branch-b'],
    });

    // 1. MIGRATION_SEQUENCE_CLASH
    const migrationClash = report.findings.find((f) => f.rule === 'MIGRATION_SEQUENCE_CLASH');
    assert.ok(migrationClash, 'Must detect MIGRATION_SEQUENCE_CLASH');
    assert.equal(migrationClash.layer, 'migration');
    assert.equal(migrationClash.severity, 'critical');

    // 2. CONCURRENT_SCHEMA_TABLE_DDL
    const schemaClash = report.findings.find((f) => f.rule === 'CONCURRENT_SCHEMA_TABLE_DDL');
    assert.ok(schemaClash, 'Must detect CONCURRENT_SCHEMA_TABLE_DDL on table users');
    assert.equal(schemaClash.layer, 'migration');
    assert.equal(schemaClash.severity, 'high');

    // 3. PORT_BINDING_CLASH
    const portClash = report.findings.find((f) => f.rule === 'PORT_BINDING_CLASH');
    assert.ok(portClash, 'Must detect PORT_BINDING_CLASH on port 4100');
    assert.equal(portClash.layer, 'infra');
    assert.equal(portClash.severity, 'high');

    // 4. DEPENDENCY_VERSION_CONFLICT
    const depConflict = report.findings.find((f) => f.rule === 'DEPENDENCY_VERSION_CONFLICT');
    assert.ok(depConflict, 'Must detect DEPENDENCY_VERSION_CONFLICT on zod');
    assert.equal(depConflict.layer, 'dependency');
    assert.equal(depConflict.severity, 'high');
  });

  test('4. Textual 3-Way Merge-Tree Conflict Without Crashing on Exit Code 1', async (t) => {
    const ctx = await createTestRepo('textual-merge-tree');
    t.after(async () => {
      await cleanupTestRepo(ctx);
    });

    const { repoDir } = ctx;

    const srcDir = path.join(repoDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'config.ts'),
      `export const TIMEOUT = 1000;\n`,
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Base config'], { cwd: repoDir });

    // Branch A
    await execGit(['checkout', '-b', 'branch-timeout-a'], { cwd: repoDir });
    await fs.writeFile(
      path.join(srcDir, 'config.ts'),
      `export const TIMEOUT = 2000;\n`,
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Set timeout 2000'], { cwd: repoDir });

    // Branch B
    await execGit(['checkout', 'main'], { cwd: repoDir });
    await execGit(['checkout', '-b', 'branch-timeout-b'], { cwd: repoDir });
    await fs.writeFile(
      path.join(srcDir, 'config.ts'),
      `export const TIMEOUT = 3000;\n`,
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Set timeout 3000'], { cwd: repoDir });

    const report = await scanRepository({
      repoRoot: repoDir,
      branches: ['branch-timeout-a', 'branch-timeout-b'],
    });

    const textConflict = report.findings.find((f) => f.layer === 'textual');
    assert.ok(textConflict, 'Must detect textual conflict via git merge-tree');
    assert.equal(textConflict.severity, 'critical');
    assert.ok(
      textConflict.files.some((file) => file.includes('config.ts')),
      'Conflicted file must include config.ts',
    );
  });

  test('5. XSS Immunity in HTML Reporter, Valid SARIF v2.1.0 & CLI Exit Codes', async (t) => {
    const ctx = await createTestRepo('reporters-and-cli');
    t.after(async () => {
      await cleanupTestRepo(ctx);
    });

    const { repoDir } = ctx;

    // Create a base file
    await fs.writeFile(
      path.join(repoDir, 'app.ts'),
      `export const version = '1.0.0';\n`,
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Initial commit'], { cwd: repoDir });

    // Branch with HTML-hostile payload
    await execGit(['checkout', '-b', 'feat/xss-test'], { cwd: repoDir });
    await fs.writeFile(
      path.join(repoDir, 'xss.ts'),
      `export const payload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';\n`,
      'utf8',
    );
    await execGit(['add', '.'], { cwd: repoDir });
    await execGit(['commit', '-m', 'Add malicious payload <script>alert("xss")</script>'], { cwd: repoDir });

    const report = await scanRepository({
      repoRoot: repoDir,
      branches: ['main', 'feat/xss-test'],
    });

    // 1. XSS Immunity in HTML Reporter
    const html = renderHtmlReport(report);
    assert.ok(!html.includes('<script>alert("xss")</script>'), 'Raw unescaped script tag must not appear in HTML');
    assert.ok(!html.includes('</script><script>'), 'Closing script tag injection must be neutralized');

    // 2. Valid SARIF v2.1.0
    const sarifRaw = renderSarifReport(report);
    const sarif = JSON.parse(sarifRaw) as { version: string; runs: Array<{ tool: { driver: { name: string } } }> };
    assert.equal(sarif.version, '2.1.0');
    assert.ok(sarif.runs.length > 0);
    assert.equal(sarif.runs[0]!.tool.driver.name.toLowerCase(), 'crossfire');

    // 3. CLI Exit Codes & Commands
    let capturedOut = '';
    let capturedErr = '';
    const mockIo = {
      stdout: (s: string) => { capturedOut += s; },
      stderr: (s: string) => { capturedErr += s; },
    };

    // a) Clean repo check: exit code 0
    const exitClean = await runCli(['check', '--cwd', repoDir, '--fail-on', 'high'], mockIo);
    assert.equal(exitClean, 0, 'Clean check should exit 0');

    // b) Conflicting check: exit code 1
    // Create an explicit conflicting branch against main
    await execGit(['checkout', 'main'], { cwd: repoDir });
    await execGit(['checkout', '-b', 'conflict-a'], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, 'app.ts'), `export const version = '2.0.0';\n`, 'utf8');
    await execGit(['commit', '-am', 'Version 2'], { cwd: repoDir });

    await execGit(['checkout', 'main'], { cwd: repoDir });
    await execGit(['checkout', '-b', 'conflict-b'], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, 'app.ts'), `export const version = '3.0.0';\n`, 'utf8');
    await execGit(['commit', '-am', 'Version 3'], { cwd: repoDir });

    const exitConflict = await runCli(
      ['check', '--cwd', repoDir, '--fail-on', 'high', '-b', 'conflict-a', '-b', 'conflict-b'],
      mockIo,
    );
    assert.equal(exitConflict, 1, 'Conflicting check should exit 1');

    // c) 'isolate' dry-run vs --write
    const exitIsolateDry = await runCli(['isolate', '--cwd', repoDir], mockIo);
    assert.equal(exitIsolateDry, 0);

    const exitIsolateWrite = await runCli(['isolate', '--cwd', repoDir, '--write'], mockIo);
    assert.equal(exitIsolateWrite, 0);

    // Verify .env.worktree.local was written
    const envLocalExists = await fs.stat(path.join(repoDir, '.env.worktree.local')).then(() => true).catch(() => false);
    assert.ok(envLocalExists, '.env.worktree.local must be written when --write is passed to isolate');

    // d) 'init-agent' dry-run vs --write
    const skillPath = path.join(repoDir, '.agents', 'skills', 'crossfire', 'SKILL.md');
    await fs.rm(path.join(repoDir, '.agents'), { recursive: true, force: true }).catch(() => {});

    const exitInitDry = await runCli(['init-agent', '--cwd', repoDir], mockIo);
    assert.equal(exitInitDry, 0);
    const skillExistsDry = await fs.stat(skillPath).then(() => true).catch(() => false);
    assert.equal(skillExistsDry, false, 'Dry run of init-agent must not write files');

    const exitInitWrite = await runCli(['init-agent', '--cwd', repoDir, '--write'], mockIo);
    assert.equal(exitInitWrite, 0);
    const skillExistsWrite = await fs.stat(skillPath).then(() => true).catch(() => false);
    assert.equal(skillExistsWrite, true, 'init-agent --write must persist SKILL.md');
  });
});
