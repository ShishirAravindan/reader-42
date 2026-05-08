/**
 * Shared types + helpers for findings emitted by toolbox scripts.
 *
 * Mirrors the `finding` shape in `report.schema.json`. Tools emit findings as
 * part of their JSON output; the convert agent collects them into
 * `output/report.json`. Pass-level results never become findings — only `warn`
 * and `fail`. Every finding must carry a calm, plain `human_message`.
 */

export type Stage = 'extract' | 'structure' | 'cleanup' | 'verify' | 'assemble';
export type Severity = 'warn' | 'fail';
export type Status = 'pass' | 'warn' | 'fail' | 'skipped';

export interface Scope {
  chapter_index?: number;
  chapter_title?: string;
  page_range?: string;
  [key: string]: unknown;
}

export interface Finding {
  id: string;
  stage: Stage;
  severity: Severity;
  type: string;
  scope?: Scope;
  human_message: string;
  technical_detail?: Record<string, unknown>;
}

export interface ToolResult {
  status: Status;
  findings: Finding[];
  [key: string]: unknown;
}

/**
 * Aggregate a status from a list of sub-statuses. `fail` dominates; otherwise
 * `warn` dominates; otherwise `skipped` if all skipped; otherwise `pass`.
 */
export function aggregateStatus(statuses: Status[]): Status {
  if (statuses.length === 0) return 'pass';
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  if (statuses.every((s) => s === 'skipped')) return 'skipped';
  return 'pass';
}

/**
 * Emit final tool output. With `--json` mode, prints structured JSON to stdout.
 * Otherwise prints a human-readable summary. Returns exit code (0 unless any
 * finding has severity `fail`).
 */
export function emit(result: ToolResult, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const summary = humanSummary(result);
    process.stdout.write(`${summary}\n`);
  }
  return result.status === 'fail' ? 1 : 0;
}

function humanSummary(result: ToolResult): string {
  const lines: string[] = [`status: ${result.status}`];
  if (result.findings.length === 0) {
    lines.push('no findings');
  } else {
    lines.push(`${result.findings.length} finding(s):`);
    for (const f of result.findings) {
      lines.push(`  [${f.severity}] ${f.id}: ${f.human_message}`);
    }
  }
  return lines.join('\n');
}
