#!/usr/bin/env bun
/**
 * drift-check — multi-signal drift detection between raw and cleaned content.
 *
 * Usage:
 *   bun tools/drift-check --raw=<path> --cleaned=<path> --mode=html|text [--json]
 *
 * Inputs:
 *   --raw=<path>      raw extracted file (HTML for URL stages, plaintext for PDF)
 *   --cleaned=<path>  cleaned-up version
 *   --mode=html|text  which input mode (controls structural check + tokenization)
 *   --json            emit JSON to stdout
 *
 * Sub-checks (all run; results aggregated):
 *   a) length_ratio        cleaned_words / raw_words; pass 0.7-1.1, warn 0.4-1.4, else fail
 *   b) ngram_fwd           5-gram coverage raw -> cleaned (catches dropped content)
 *   c) ngram_inv           5-gram coverage cleaned -> raw (catches hallucinated content)
 *   d) structural          HTML-only: every <a href> + <img src> + heading text
 *                          present in cleaned (URL chapters must preserve these)
 *   e) judge               LLM-as-judge stub: returns skipped in v1; documents
 *                          what would be invoked in a future iteration
 *
 * Output: ToolResult JSON with `sub_results` map alongside findings. Each
 * finding follows report.schema.json's finding shape; `human_message` is
 * written calmly and plainly (this tool is the drift-detection workhorse and
 * the model for how downstream copy should read).
 *
 * Exit codes: 0 on pass or warn; 1 if any sub-check is fail.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getString, hasFlag, parseArgs } from './lib/args.ts';
import {
  aggregateStatus,
  emit,
  type Finding,
  type Status,
  type ToolResult,
} from './lib/findings.ts';

// ---- thresholds (kept local to make tuning explicit) ----

const LENGTH_PASS_LO = 0.7;
const LENGTH_PASS_HI = 1.1;
const LENGTH_WARN_LO = 0.4;
const LENGTH_WARN_HI = 1.4;

const NGRAM_PASS = 0.85;
const NGRAM_WARN = 0.65;
const NGRAM_SAMPLE_SIZE = 200;
const NGRAM_N = 5;

const STRUCTURAL_PASS = 1.0;
const STRUCTURAL_WARN = 0.9;

// Common-word filter for n-gram sampling: skip 5-grams that are >= this
// fraction of stop-words. Distinctive 5-grams give the coverage check signal.
const STOPWORD_RATIO_MAX = 0.6;
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'for', 'from', 'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is',
  'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our',
  'so', 'that', 'the', 'their', 'them', 'then', 'there', 'they',
  'this', 'to', 'was', 'we', 'were', 'what', 'when', 'which', 'who',
  'will', 'with', 'would', 'you', 'your',
]);

// ---- types ----

export type Mode = 'html' | 'text';

export interface DriftCheckInput {
  raw: string;
  cleaned: string;
  mode: Mode;
  /** Optional: deterministic seed for sampling, used in tests. */
  seed?: number;
}

export interface SubResult {
  status: Status;
  detail: Record<string, unknown>;
}

export interface DriftCheckResult extends ToolResult {
  sub_results: {
    length_ratio: SubResult;
    ngram_fwd: SubResult;
    ngram_inv: SubResult;
    structural: SubResult;
    judge: SubResult;
  };
}

// ---- main entry ----

export function driftCheck(input: DriftCheckInput): DriftCheckResult {
  const findings: Finding[] = [];

  const rawText = input.mode === 'html' ? stripHtml(input.raw) : input.raw;
  const cleanedText =
    input.mode === 'html' ? stripHtml(input.cleaned) : input.cleaned;

  const lengthSub = checkLengthRatio(rawText, cleanedText);
  if (lengthSub.finding) findings.push(lengthSub.finding);

  const fwdSub = checkNgramCoverage(rawText, cleanedText, 'fwd', input.seed);
  if (fwdSub.finding) findings.push(fwdSub.finding);

  const invSub = checkNgramCoverage(cleanedText, rawText, 'inv', input.seed);
  if (invSub.finding) findings.push(invSub.finding);

  const structuralSub =
    input.mode === 'html'
      ? checkStructural(input.raw, input.cleaned)
      : skippedSub('Structural preservation only runs on HTML inputs.');
  if (structuralSub.finding) findings.push(structuralSub.finding);

  const judgeSub = stubJudge();
  // Judge is a stub: never produces a finding in v1.

  const status = aggregateStatus([
    lengthSub.result.status,
    fwdSub.result.status,
    invSub.result.status,
    structuralSub.result.status,
    // judge stub stays 'skipped' and shouldn't dominate aggregation
    judgeSub.status === 'skipped' ? 'pass' : judgeSub.status,
  ]);

  return {
    status,
    findings,
    sub_results: {
      length_ratio: lengthSub.result,
      ngram_fwd: fwdSub.result,
      ngram_inv: invSub.result,
      structural: structuralSub.result,
      judge: judgeSub,
    },
  };
}

// ---- (a) length ratio ----

function checkLengthRatio(
  raw: string,
  cleaned: string,
): { result: SubResult; finding: Finding | null } {
  const rawWords = countWords(raw);
  const cleanedWords = countWords(cleaned);
  if (rawWords === 0) {
    return {
      result: {
        status: 'fail',
        detail: { raw_words: 0, cleaned_words: cleanedWords, ratio: null },
      },
      finding: {
        id: 'drift-length-raw-empty',
        stage: 'cleanup',
        severity: 'fail',
        type: 'drift',
        human_message:
          'The raw extracted text is empty, so we cannot compare against the cleaned version. Re-run the extract stage before cleanup.',
        technical_detail: { raw_words: 0, cleaned_words: cleanedWords },
      },
    };
  }
  const ratio = cleanedWords / rawWords;

  let status: Status = 'pass';
  if (ratio < LENGTH_WARN_LO || ratio > LENGTH_WARN_HI) status = 'fail';
  else if (ratio < LENGTH_PASS_LO || ratio > LENGTH_PASS_HI) status = 'warn';

  if (status === 'pass') {
    return {
      result: { status, detail: { ratio, raw_words: rawWords, cleaned_words: cleanedWords } },
      finding: null,
    };
  }

  const direction = ratio < 1 ? 'shorter' : 'longer';
  const pct = Math.round(ratio * 100);
  const human =
    status === 'fail'
      ? `The cleaned chapter is ${pct}% the length of the raw input — that is well outside the safe range. Cleanup probably dropped or duplicated content; re-run cleanup or fall back to a lighter-touch pass.`
      : `The cleaned chapter is ${pct}% the length of the raw input. That's a bit ${direction} than expected — spot-check that no paragraphs were trimmed or duplicated.`;

  return {
    result: {
      status,
      detail: { ratio, raw_words: rawWords, cleaned_words: cleanedWords },
    },
    finding: {
      id: `drift-length-${status}`,
      stage: 'cleanup',
      severity: status,
      type: 'drift',
      human_message: human,
      technical_detail: {
        ratio,
        raw_words: rawWords,
        cleaned_words: cleanedWords,
      },
    },
  };
}

// ---- (b)/(c) n-gram coverage ----

function checkNgramCoverage(
  source: string,
  target: string,
  direction: 'fwd' | 'inv',
  seed: number | undefined,
): { result: SubResult; finding: Finding | null } {
  const ngrams = sampleDistinctiveNgrams(source, NGRAM_N, NGRAM_SAMPLE_SIZE, seed);
  if (ngrams.length === 0) {
    return {
      result: {
        status: 'pass',
        detail: { sampled: 0, reason: 'too-short-to-sample' },
      },
      finding: null,
    };
  }

  const normTarget = normalizeForMatch(target);
  let hit = 0;
  for (const ng of ngrams) {
    if (normTarget.includes(ng)) hit += 1;
  }
  const coverage = hit / ngrams.length;

  let status: Status = 'pass';
  if (coverage < NGRAM_WARN) status = 'fail';
  else if (coverage < NGRAM_PASS) status = 'warn';

  const detail = {
    sampled: ngrams.length,
    matched: hit,
    coverage,
  };

  if (status === 'pass') {
    return { result: { status, detail }, finding: null };
  }

  const pct = Math.round(coverage * 100);
  const human =
    direction === 'fwd'
      ? status === 'fail'
        ? `Only ${pct}% of distinctive phrases from the raw input survived into the cleaned output. Cleanup likely dropped substantial content — re-run with a lighter-touch pass.`
        : `${pct}% of distinctive phrases from the raw input made it into the cleaned output. A few passages may have been dropped during cleanup; spot-check the chapter against the source.`
      : status === 'fail'
        ? `Only ${pct}% of distinctive phrases in the cleaned output trace back to the raw input — the rest may be hallucinated. Re-run cleanup with stricter constraints.`
        : `${pct}% of distinctive phrases in the cleaned output trace back to the raw input. Some phrasing may have been added that wasn't in the source; spot-check against the original.`;

  return {
    result: { status, detail },
    finding: {
      id: `drift-ngram-${direction}-${status}`,
      stage: 'cleanup',
      severity: status,
      type: 'drift',
      human_message: human,
      technical_detail: detail,
    },
  };
}

function sampleDistinctiveNgrams(
  text: string,
  n: number,
  sampleSize: number,
  seed: number | undefined,
): string[] {
  const tokens = tokenize(text);
  if (tokens.length < n) return [];

  const ngrams: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const window = tokens.slice(i, i + n);
    const stopFraction =
      window.filter((t) => STOPWORDS.has(t)).length / window.length;
    if (stopFraction > STOPWORD_RATIO_MAX) continue;
    const ng = window.join(' ');
    if (seen.has(ng)) continue;
    seen.add(ng);
    ngrams.push(ng);
  }

  if (ngrams.length <= sampleSize) return ngrams;

  // Deterministic sample: stride evenly through the candidate list. Optionally
  // perturb with seed for tests.
  const stride = ngrams.length / sampleSize;
  const offset = seed !== undefined ? seed % Math.max(1, Math.floor(stride)) : 0;
  const out: string[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.min(ngrams.length - 1, Math.floor(i * stride) + offset);
    const ng = ngrams[idx];
    if (ng !== undefined) out.push(ng);
  }
  return out;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  return tokenize(text).length;
}

// ---- (d) structural preservation (HTML only) ----

function checkStructural(
  rawHtml: string,
  cleanedHtml: string,
): { result: SubResult; finding: Finding | null } {
  const rawHrefs = extractAttr(rawHtml, 'a', 'href');
  const rawSrcs = extractAttr(rawHtml, 'img', 'src');
  const rawHeadings = extractHeadings(rawHtml);

  const cleanedHrefs = new Set(extractAttr(cleanedHtml, 'a', 'href'));
  const cleanedSrcs = new Set(extractAttr(cleanedHtml, 'img', 'src'));
  const cleanedFlat = stripHtml(cleanedHtml).replace(/\s+/g, ' ').toLowerCase();

  const missingHrefs = rawHrefs.filter((h) => !cleanedHrefs.has(h));
  const missingSrcs = rawSrcs.filter((s) => !cleanedSrcs.has(s));
  const missingHeadings = rawHeadings.filter(
    (h) => !cleanedFlat.includes(h.toLowerCase()),
  );

  const totalRequired = rawHrefs.length + rawSrcs.length + rawHeadings.length;
  const totalMissing =
    missingHrefs.length + missingSrcs.length + missingHeadings.length;

  if (totalRequired === 0) {
    return {
      result: {
        status: 'pass',
        detail: {
          required: 0,
          reason: 'no structural elements in raw',
        },
      },
      finding: null,
    };
  }

  const preservation = (totalRequired - totalMissing) / totalRequired;
  let status: Status = 'pass';
  if (preservation < STRUCTURAL_WARN) status = 'fail';
  else if (preservation < STRUCTURAL_PASS) status = 'warn';

  const detail = {
    required: totalRequired,
    missing: totalMissing,
    preservation,
    missing_hrefs: missingHrefs.slice(0, 10),
    missing_srcs: missingSrcs.slice(0, 10),
    missing_headings: missingHeadings.slice(0, 10),
  };

  if (status === 'pass') {
    return { result: { status, detail }, finding: null };
  }

  const pct = Math.round(preservation * 100);
  const parts: string[] = [];
  if (missingHrefs.length > 0) parts.push(`${missingHrefs.length} hyperlink(s)`);
  if (missingSrcs.length > 0) parts.push(`${missingSrcs.length} image(s)`);
  if (missingHeadings.length > 0)
    parts.push(`${missingHeadings.length} heading(s)`);
  const summary = parts.join(', ');

  const human =
    status === 'fail'
      ? `Cleanup dropped structural elements: ${summary} are missing from the cleaned output (${pct}% preserved). Re-run cleanup with HTML preservation enforced.`
      : `Cleanup dropped a few structural elements: ${summary} are missing (${pct}% preserved). Confirm those weren't load-bearing for the article.`;

  return {
    result: { status, detail },
    finding: {
      id: `drift-structural-${status}`,
      stage: 'cleanup',
      severity: status,
      type: 'drift',
      human_message: human,
      technical_detail: detail,
    },
  };
}

function extractAttr(html: string, tag: string, attr: string): string[] {
  // Capture both quote styles. We only need attribute values for presence
  // checks, not full HTML parsing.
  const re = new RegExp(
    `<${tag}\\b[^>]*?\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'gi',
  );
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const v = m[1] ?? m[2];
    if (v !== undefined && v !== '') out.push(v);
  }
  return out;
}

function extractHeadings(html: string): string[] {
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const inner = m[2];
    if (inner === undefined) continue;
    const text = stripHtml(inner).replace(/\s+/g, ' ').trim();
    if (text.length > 0) out.push(text);
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---- (e) LLM judge — v1 stub ----

function stubJudge(): SubResult {
  return {
    status: 'skipped',
    detail: {
      reason: 'LLM judge not enabled in v1 stub; wire up in a later iteration',
      planned: {
        invocation:
          'For each ~500-word window flagged by checks (a)-(d), call the cleanup model in judge mode with a prompt asking whether the cleaned span is faithful to the raw span.',
        prompt_template: 'TBD',
        expected_output_schema: {
          window_index: 'integer',
          verdict: 'faithful | drifted | hallucinated',
          rationale: 'short string',
          confidence: 'number 0..1',
        },
      },
    },
  };
}

function skippedSub(reason: string): { result: SubResult; finding: null } {
  return {
    result: { status: 'skipped', detail: { reason } },
    finding: null,
  };
}

// ---- CLI entry ----

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = getString(args, 'raw');
  const cleanedPath = getString(args, 'cleaned');
  const mode = getString(args, 'mode');
  const json = hasFlag(args, 'json');

  if (!rawPath || !cleanedPath) {
    process.stderr.write(
      'drift-check: --raw=<path> and --cleaned=<path> are required\n',
    );
    process.exit(2);
  }
  if (mode !== 'html' && mode !== 'text') {
    process.stderr.write('drift-check: --mode=html|text is required\n');
    process.exit(2);
  }
  const rawAbs = resolve(rawPath);
  const cleanedAbs = resolve(cleanedPath);
  if (!existsSync(rawAbs) || !existsSync(cleanedAbs)) {
    process.stderr.write(
      `drift-check: input file(s) missing (raw=${rawAbs}, cleaned=${cleanedAbs})\n`,
    );
    process.exit(2);
  }
  const result = driftCheck({
    raw: readFileSync(rawAbs, 'utf8'),
    cleaned: readFileSync(cleanedAbs, 'utf8'),
    mode,
  });
  process.exit(emit(result, json));
}
