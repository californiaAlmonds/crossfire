import { spawn } from 'node:child_process';
import * as os from 'node:os';

export interface GitExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  allowExitCodes?: number[];
  maxBufferBytes?: number;
}

export interface GitExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutBuffer: Buffer;
}

export async function execGit(args: string[], options: GitExecOptions): Promise<GitExecResult> {
  const allowExitCodes = options.allowExitCodes ?? [0];
  const maxBuffer = options.maxBufferBytes ?? 1024 * 1024 * 100; // 100MB default

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutLen += chunk.length;
      if (stdoutLen > maxBuffer) {
        child.kill();
        reject(new Error(`git ${args.join(' ')} exceeded maxBufferBytes`));
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrLen += chunk.length;
      if (stderrLen > maxBuffer) {
        child.kill();
        reject(new Error(`git ${args.join(' ')} exceeded maxBufferBytes on stderr`));
      }
      stderrChunks.push(chunk);
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });

    child.on('close', (code: number | null) => {
      const exitCode = code ?? 128;
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (!allowExitCodes.includes(exitCode)) {
        reject(new Error(`git ${args.join(' ')} exited with ${exitCode}\nStderr: ${stderr}`));
        return;
      }

      resolve({
        exitCode,
        stdout: stdoutBuffer.toString('utf8'),
        stderr,
        stdoutBuffer
      });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

export async function resolveRepoRoot(cwd: string): Promise<string> {
  const res = await execGit(['rev-parse', '--show-toplevel'], { cwd });
  return res.stdout.trim();
}
