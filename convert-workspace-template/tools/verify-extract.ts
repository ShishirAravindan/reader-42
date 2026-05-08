#!/usr/bin/env bun
/**
 * verify-extract — extraction sanity gate
 *
 * Usage:
 *   bun tools/verify-extract --source-type=url --raw=extracted/raw.html [--json]
 *   bun tools/verify-extract --source-type=pdf --raw=extracted/raw.txt [--json]
 *
 * Inputs:
 *   --source-type=url|pdf   what was extracted
 *   --raw=<path>            path to the raw extracted artifact
 *   --json                  emit JSON to stdout (otherwise human-readable)
 *
 * Output: ToolResult JSON (status + findings). Findings follow the
 * report.schema.json finding shape. Exit code 0 on pass/warn, 1 on fail.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getString, hasFlag, parseArgs } from './lib/args.ts';
import { type Finding, type ToolResult, emit } from './lib/findings.ts';

const PARAGRAPH_MIN_CHARS = 80;
const PDF_MIN_WORDS = 50;

export interface VerifyExtractInput {
  sourceType: 'url' | 'pdf';
  rawPath: string;
}

export function verifyExtract(input: VerifyExtractInput): ToolResult {
  const findings: Finding[] = [];
  const abs = resolve(input.rawPath);

  if (!existsSync(abs)) {
    findings.push({
      id: 'verify-extract-missing',
      stage: 'extract',
      severity: 'fail',
      type: 'extract-missing',
      human_message: `The extracted file is missing at ${input.rawPath}. Re-run the extract stage and confirm the artifact landed on disk.`,
      technical_detail: { path: abs },
    });
    return { status: 'fail', findings };
  }

  const size = statSync(abs).size;
  if (size === 0) {
    findings.push({
      id: 'verify-extract-empty',
      stage: 'extract',
      severity: 'fail',
      type: 'extract-empty',
      human_message: `The extracted file at ${input.rawPath} is empty. Extraction produced no content — try a different extractor or check the source.`,
      technical_detail: { path: abs, size: 0 },
    });
    return { status: 'fail', findings };
  }

  const text = readFileSync(abs, 'utf8');

  if (input.sourceType === 'url') {
    findings.push(...checkUrlExtract(text, input.rawPath));
  } else {
    findings.push(...checkPdfExtract(text, input.rawPath));
  }

  const hasFail = findings.some((f) => f.severity === 'fail');
  const hasWarn = findings.some((f) => f.severity === 'warn');
  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    findings,
    bytes: size,
  };
}

function checkUrlExtract(text: string, path: string): Finding[] {
  const findings: Finding[] = [];

  // Crude but sufficient: at least one paragraph-equivalent of plain text.
  const stripped = stripTags(text).replace(/\s+/g, ' ').trim();
  if (stripped.length < PARAGRAPH_MIN_CHARS) {
    findings.push({
      id: 'verify-extract-thin',
      stage: 'extract',
      severity: 'fail',
      type: 'extract-thin',
      human_message: `The URL extract from ${path} contains very little readable text (under ${PARAGRAPH_MIN_CHARS} characters after stripping markup). The page may have been a navigation shell, paywall, or JS-rendered.`,
      technical_detail: { stripped_length: stripped.length, path },
    });
  }

  // If extracted file is HTML (mode says url), expect at least one anchor —
  // virtually every real article body has at least one link. The agent passes
  // HTML for URL extracts; if we see no anchors at all, flag it as a warning
  // (some legitimate articles really have none, so don't fail).
  const looksHtml = /<\w+[^>]*>/.test(text);
  if (looksHtml) {
    const anchorCount = countMatches(text, /<a\s[^>]*href=/gi);
    if (anchorCount === 0) {
      findings.push({
        id: 'verify-extract-no-anchors',
        stage: 'extract',
        severity: 'warn',
        type: 'extract-no-anchors',
        human_message: `The URL extract has no hyperlinks. That's unusual for a web article — confirm the extractor preserved <a> tags rather than collapsing them to plain text.`,
        technical_detail: { path },
      });
    }
  }

  return findings;
}

function checkPdfExtract(text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < PDF_MIN_WORDS) {
    findings.push({
      id: 'verify-extract-pdf-thin',
      stage: 'extract',
      severity: 'fail',
      type: 'extract-thin',
      human_message: `The PDF extract from ${path} contains only ${wordCount} word(s). Either the PDF is image-only and needs OCR, or the extractor failed.`,
      technical_detail: { word_count: wordCount, path },
    });
  }
  return findings;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

function countMatches(text: string, re: RegExp): number {
  let count = 0;
  for (const _ of text.matchAll(re)) count += 1;
  return count;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const sourceType = getString(args, 'source-type');
  const rawPath = getString(args, 'raw');
  const json = hasFlag(args, 'json');

  if (sourceType !== 'url' && sourceType !== 'pdf') {
    process.stderr.write('verify-extract: --source-type=url|pdf is required\n');
    process.exit(2);
  }
  if (!rawPath) {
    process.stderr.write('verify-extract: --raw=<path> is required\n');
    process.exit(2);
  }

  const result = verifyExtract({ sourceType, rawPath });
  process.exit(emit(result, json));
}
