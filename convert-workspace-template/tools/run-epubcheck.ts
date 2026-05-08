#!/usr/bin/env bun
/**
 * run-epubcheck — wrap the `epubcheck` CLI and emit structured findings.
 *
 * Usage:
 *   bun tools/run-epubcheck output/book.epub [--json]
 *
 * Inputs:
 *   <path-to-epub>   positional, required
 *   --json           emit JSON to stdout
 *
 * Behavior:
 *   - If `epubcheck` is not on PATH, emit status=skipped and exit 0 (don't
 *     block conversion in dev environments where it isn't installed yet),
 *     but do emit a finding so the orchestrator sees it.
 *   - Otherwise run `epubcheck <path> --json -` and parse the output. Map
 *     epubcheck severity ERROR -> fail, WARNING -> warn, INFO/USAGE -> ignore.
 *
 * Exit codes: 0 on pass/warn/skipped, 1 if any ERROR-level message is found.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasFlag, parseArgs } from './lib/args.ts';
import { type Finding, type ToolResult, emit } from './lib/findings.ts';

interface EpubcheckLocation {
  path?: string;
  line?: number;
  column?: number;
}

interface EpubcheckMessage {
  ID?: string;
  severity?: string;
  message?: string;
  locations?: EpubcheckLocation[];
  suggestion?: string;
}

interface EpubcheckJson {
  messages?: EpubcheckMessage[];
}

export interface RunEpubcheckOpts {
  /** Override which command to run (used in tests). Defaults to 'epubcheck'. */
  command?: string;
  /**
   * Inject a runner for tests so we don't shell out. If provided, this is
   * called instead of spawnSync; signature mirrors what we need.
   */
  runner?: (cmd: string, args: string[]) => SpawnLike;
}

export interface SpawnLike {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: { code?: string } | null;
}

export function runEpubcheck(epubPath: string, opts: RunEpubcheckOpts = {}): ToolResult {
  const findings: Finding[] = [];
  const abs = resolve(epubPath);

  if (!existsSync(abs)) {
    findings.push({
      id: 'run-epubcheck-missing-input',
      stage: 'assemble',
      severity: 'fail',
      type: 'epubcheck',
      human_message: `No EPUB to validate at ${epubPath}. The assemble stage didn't produce its output.`,
      technical_detail: { path: abs },
    });
    return { status: 'fail', findings };
  }

  const command = opts.command ?? 'epubcheck';
  const runner = opts.runner ?? defaultRunner;
  const result = runner(command, [abs, '--json', '-']);

  if (result.error?.code === 'ENOENT' || result.status === null) {
    findings.push({
      id: 'run-epubcheck-not-installed',
      stage: 'assemble',
      severity: 'warn',
      type: 'epubcheck',
      human_message: `The epubcheck CLI isn't installed on this machine, so the EPUB couldn't be validated. Install epubcheck (Java) and re-run to confirm the file is reading-ready.`,
      technical_detail: { command, error_code: result.error?.code ?? 'unknown' },
    });
    return { status: 'skipped', findings, reason: 'epubcheck not installed' };
  }

  // epubcheck writes its JSON report to stdout when --json - is used. Some
  // versions also print a banner to stderr; ignore that.
  const parsed = tryParseEpubcheckJson(result.stdout);
  if (!parsed) {
    findings.push({
      id: 'run-epubcheck-unparseable',
      stage: 'assemble',
      severity: 'fail',
      type: 'epubcheck',
      human_message: `epubcheck ran but produced output we couldn't parse. The EPUB may still be valid; check the raw output manually.`,
      technical_detail: {
        exit_status: result.status,
        stdout_preview: result.stdout.slice(0, 500),
        stderr_preview: result.stderr.slice(0, 500),
      },
    });
    return { status: 'fail', findings };
  }

  const messages = parsed.messages ?? [];
  for (const msg of messages) {
    const sev = (msg.severity ?? '').toUpperCase();
    if (sev !== 'ERROR' && sev !== 'WARNING') continue;
    const id = msg.ID ?? 'EPUBCHECK';
    const where = formatLocations(msg.locations);
    findings.push({
      id: `epubcheck-${id}-${findings.length}`,
      stage: 'assemble',
      severity: sev === 'ERROR' ? 'fail' : 'warn',
      type: 'epubcheck',
      human_message: humanFromEpubcheck(id, msg.message ?? '', where),
      technical_detail: {
        epubcheck_id: id,
        epubcheck_severity: sev,
        message: msg.message,
        locations: msg.locations,
        suggestion: msg.suggestion,
      },
    });
  }

  const hasFail = findings.some((f) => f.severity === 'fail');
  const hasWarn = findings.some((f) => f.severity === 'warn');
  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    findings,
    epubcheck_messages: messages.length,
  };
}

function defaultRunner(cmd: string, args: string[]): SpawnLike {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error ? { code: (r.error as NodeJS.ErrnoException).code } : null,
  };
}

function tryParseEpubcheckJson(stdout: string): EpubcheckJson | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as EpubcheckJson;
  } catch {
    // epubcheck sometimes prefixes the JSON with non-JSON banner text.
    // Try to recover by locating the first '{' and parsing from there.
    const first = trimmed.indexOf('{');
    if (first === -1) return null;
    try {
      return JSON.parse(trimmed.slice(first)) as EpubcheckJson;
    } catch {
      return null;
    }
  }
}

function formatLocations(locations: EpubcheckLocation[] | undefined): string {
  if (!locations || locations.length === 0) return '';
  const first = locations[0];
  if (!first) return '';
  const parts = [first.path, first.line ? `line ${first.line}` : null].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function humanFromEpubcheck(id: string, raw: string, where: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (cleaned === '') {
    return `epubcheck reported issue ${id}${where}.`;
  }
  return `epubcheck flagged ${id}${where}: ${cleaned}`;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const json = hasFlag(args, 'json');
  const epub = args.positional[0];
  if (!epub) {
    process.stderr.write('run-epubcheck: positional <path-to-epub> is required\n');
    process.exit(2);
  }
  const result = runEpubcheck(epub);
  process.exit(emit(result, json));
}
