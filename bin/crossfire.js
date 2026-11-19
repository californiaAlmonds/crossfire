#!/usr/bin/env node
import { runCli } from '../dist/src/cli.js';

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`crossfire: fatal error: ${msg}\n`);
    process.exitCode = 2;
  },
);
