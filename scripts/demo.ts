import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  execGit,
  renderAnsiReport,
  renderHtmlReport,
  scanRepository,
} from '../src/index.js';

async function main() {
  const baseDir = path.resolve(process.cwd(), '.crossfire-tmp', 'demo-repo');
  const mainRepoDir = path.join(baseDir, 'main');
  const projectRoot = process.cwd();

  console.log('🚀 [Crossfire Demo] Setting up 4-worktree parallel AI coding agent workspace...');

  // Prune any previous worktrees and recreate demo directory
  try {
    await execGit(['worktree', 'prune'], { cwd: mainRepoDir, allowExitCodes: [0, 1, 128] });
  } catch {}
  await fs.rm(baseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await fs.mkdir(mainRepoDir, { recursive: true });

  // 1. Initialize main git repo
  await execGit(['init'], { cwd: mainRepoDir });
  await execGit(['checkout', '-b', 'main'], { cwd: mainRepoDir, allowExitCodes: [0, 1] });
  await execGit(['config', 'user.name', 'Demo Lead'], { cwd: mainRepoDir });
  await execGit(['config', 'user.email', 'lead@crossfire.local'], { cwd: mainRepoDir });
  await execGit(['config', 'commit.gpgSign', 'false'], { cwd: mainRepoDir });

  // 2. Commit initial baseline files
  await fs.mkdir(path.join(mainRepoDir, 'src'), { recursive: true });
  await fs.mkdir(path.join(mainRepoDir, 'migrations'), { recursive: true });

  await fs.writeFile(
    path.join(mainRepoDir, 'src', 'auth.ts'),
    `export function verifySession(token: string) {\n  return token.length > 0;\n}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(mainRepoDir, 'src', 'billing.ts'),
    `export function createInvoice(customerId: string, amount: number) {\n  return { customerId, amount, status: 'draft' as const };\n}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(mainRepoDir, 'src', 'db.ts'),
    `export const DB_POOL_SIZE = 10;\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(mainRepoDir, 'src', 'ui.ts'),
    `export function renderButton(label: string) {\n  return \`<button class="btn">\${label}</button>\`;\n}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(mainRepoDir, 'migrations', '0001_init.sql'),
    `CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE\n);\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(mainRepoDir, 'package.json'),
    JSON.stringify(
      {
        name: 'crossfire-demo-app',
        version: '1.0.0',
        dependencies: {
          zod: '^3.22.0',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(mainRepoDir, '.env'),
    `PORT=3000\nCOMPOSE_PROJECT_NAME=demo-app\n`,
    'utf8',
  );

  await execGit(['add', '.'], { cwd: mainRepoDir });
  await execGit(['commit', '-m', 'Initial baseline codebase'], { cwd: mainRepoDir });

  // 3. Create 4 parallel worktrees for AI agents
  const wtAuth = path.join(baseDir, 'wt-agent-auth');
  const wtBilling = path.join(baseDir, 'wt-agent-billing');
  const wtDb = path.join(baseDir, 'wt-agent-db');
  const wtUi = path.join(baseDir, 'wt-agent-ui');

  await execGit(['worktree', 'add', '-b', 'agent-auth', wtAuth], { cwd: mainRepoDir });
  await execGit(['worktree', 'add', '-b', 'agent-billing', wtBilling], { cwd: mainRepoDir });
  await execGit(['worktree', 'add', '-b', 'agent-db', wtDb], { cwd: mainRepoDir });
  await execGit(['worktree', 'add', '-b', 'agent-ui', wtUi], { cwd: mainRepoDir });

  // Agent A (wt-agent-auth): Breaking change to verifySession arity + port 4000
  await fs.writeFile(
    path.join(wtAuth, 'src', 'auth.ts'),
    `export function verifySession(token: string, tenantId: string) {\n  return token.length > 0 && tenantId.length > 0;\n}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(wtAuth, '.env'),
    `PORT=4000\nCOMPOSE_PROJECT_NAME=agent-auth\n`,
    'utf8',
  );

  // Agent B (wt-agent-billing): Calls verifySession with 1 arg + updates zod to v4
  await fs.writeFile(
    path.join(wtBilling, 'src', 'checkout.ts'),
    [
      `import { verifySession } from './auth.js';`,
      `import { createInvoice } from './billing.js';`,
      '',
      `export function processCheckout(token: string, amount: number) {`,
      `  if (!verifySession(token)) {`,
      `    throw new Error('Unauthorized');`,
      `  }`,
      `  return createInvoice('cust_default', amount);`,
      `}`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(wtBilling, 'package.json'),
    JSON.stringify(
      {
        name: 'crossfire-demo-app',
        version: '1.0.0',
        dependencies: {
          zod: '^4.0.0',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  // Agent C (wt-agent-db): Adds DDL on table users + port 4000 collision
  await fs.writeFile(
    path.join(wtDb, 'migrations', '0002_user_profiles.sql'),
    `ALTER TABLE users ADD COLUMN phone TEXT;\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(wtDb, '.env'),
    `PORT=4000\nCOMPOSE_PROJECT_NAME=agent-auth\n`,
    'utf8',
  );

  // Agent D (wt-agent-ui): 100% clean, orthogonal UI polish
  await fs.writeFile(
    path.join(wtUi, 'src', 'ui.ts'),
    [
      `export function renderButton(label: string) {`,
      `  return \`<button class="btn">\${label}</button>\`;`,
      `}`,
      '',
      `export function renderBadge(count: number) {`,
      `  return \`<span class="badge">\${count}</span>\`;`,
      `}`,
      '',
    ].join('\n'),
    'utf8',
  );

  console.log('🔍 [Crossfire Demo] Scanning active worktrees for multi-layer collisions...\n');

  // 4. Run Crossfire Scan across the worktrees
  const report = await scanRepository({ repoRoot: mainRepoDir });

  // 5. Render ANSI terminal report
  const ansiOutput = renderAnsiReport(report, { color: true });
  process.stdout.write(ansiOutput);
  process.stdout.write('\n');

  // 6. Write interactive HTML Collision Radar to project root
  const htmlOutput = renderHtmlReport(report);
  const htmlPath = path.resolve(projectRoot, 'crossfire-report.html');
  await fs.writeFile(htmlPath, htmlOutput, 'utf8');

  console.log('\n================================================================');
  console.log(`✨ Interactive HTML Collision Radar generated at:`);
  console.log(`   file://${htmlPath.replace(/\\/g, '/')}`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
