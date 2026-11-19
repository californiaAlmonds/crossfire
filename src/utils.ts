import { createHash } from 'node:crypto';
import type { CollisionFinding, CollisionLayer, Severity } from './types.js';

export const CROSSFIRE_VERSION = '1.0.0';

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
};

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Normalize any Windows or mixed filesystem path to Git-compatible POSIX forward slashes.
 */
export function toPosixPath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Strictly escape untrusted strings (branch names, file paths, code snippets) for safe HTML rendering.
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize any JSON-safe value for embedding inside an inline `<script>` tag
 * without allowing `</script>`, `<!--`, or U+2028/U+2029 breakouts.
 */
export function safeJsonEmbed(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Deterministic 10-hex-character finding ID for stable JSON/SARIF deduplication.
 */
export function makeFindingId(parts: {
  layer: CollisionLayer;
  rule: string;
  unitA: string;
  unitB: string;
  files: string[];
  detail?: string;
}): string {
  const orderedUnits = [parts.unitA, parts.unitB].sort().join('<->');
  const orderedFiles = [...parts.files].map(toPosixPath).sort().join(',');
  const payload = `${parts.layer}|${parts.rule}|${orderedUnits}|${orderedFiles}|${parts.detail ?? ''}`;
  return `cf-${createHash('sha256').update(payload).digest('hex').slice(0, 10)}`;
}

/**
 * Sort findings deterministically by severity (descending), then layer, rule, and primary file.
 */
export function sortFindings(findings: CollisionFinding[]): CollisionFinding[] {
  return [...findings].sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    const layerDiff = a.layer.localeCompare(b.layer);
    if (layerDiff !== 0) return layerDiff;
    const ruleDiff = a.rule.localeCompare(b.rule);
    if (ruleDiff !== 0) return ruleDiff;
    return (a.files[0] ?? '').localeCompare(b.files[0] ?? '');
  });
}

/**
 * Detect binary content (checks first 8 KB for NUL byte, matching Git's binary heuristic).
 */
export function isBinaryBuffer(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Check if finding severity meets or exceeds a fail threshold.
 */
export function meetsFailThreshold(
  severity: Severity,
  threshold: Severity,
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}
