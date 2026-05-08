#!/usr/bin/env bun
/**
 * verify-structure — structure.json sanity gate
 *
 * Usage:
 *   bun tools/verify-structure --structure=structure.json [--json]
 *
 * Inputs:
 *   --structure=<path>   path to structure.json produced in stage 2
 *   --json               emit JSON to stdout
 *
 * Output: ToolResult JSON. Exit 0 on pass/warn, 1 on fail.
 *
 * Checks:
 *   - parses as JSON, has chapters: [] non-empty
 *   - chapter titles non-empty, no obvious OCR-junk patterns
 *   - chapter lengths plausible: not all zero; not one giant chapter
 *     unless source is single-section
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getString, hasFlag, parseArgs } from './lib/args.ts';
import { emit, type Finding, type ToolResult } from './lib/findings.ts';

interface StructureFile {
  chapters?: Chapter[];
  source_type?: 'url' | 'pdf' | 'url_series';
  [key: string]: unknown;
}

interface Chapter {
  title?: string;
  length?: number;
  word_count?: number;
  page_range?: string;
  [key: string]: unknown;
}

const JUNK_BRACKET_RATIO = 0.15;

export function verifyStructure(structurePath: string): ToolResult {
  const findings: Finding[] = [];
  const abs = resolve(structurePath);

  if (!existsSync(abs)) {
    findings.push({
      id: 'verify-structure-missing',
      stage: 'structure',
      severity: 'fail',
      type: 'structure-missing',
      human_message: `structure.json is missing at ${structurePath}. The structure stage didn't produce its output artifact.`,
      technical_detail: { path: abs },
    });
    return { status: 'fail', findings };
  }

  let parsed: StructureFile;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8')) as StructureFile;
  } catch (err) {
    findings.push({
      id: 'verify-structure-unparseable',
      stage: 'structure',
      severity: 'fail',
      type: 'structure-invalid',
      human_message: `structure.json could not be parsed as JSON. Check for trailing commas, unquoted keys, or truncated output from the structure stage.`,
      technical_detail: {
        path: abs,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { status: 'fail', findings };
  }

  const chapters = parsed.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    findings.push({
      id: 'verify-structure-no-chapters',
      stage: 'structure',
      severity: 'fail',
      type: 'structure-empty',
      human_message: `structure.json has no chapters. The structure stage didn't detect any chapter boundaries — try a different splitter.`,
      technical_detail: {
        path: abs,
        chapters: Array.isArray(chapters) ? chapters.length : null,
      },
    });
    return { status: 'fail', findings };
  }

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    if (ch === undefined) continue;
    findings.push(...checkChapter(ch, i));
  }

  findings.push(...checkChapterLengths(chapters, parsed.source_type));

  const hasFail = findings.some((f) => f.severity === 'fail');
  const hasWarn = findings.some((f) => f.severity === 'warn');
  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    findings,
    chapter_count: chapters.length,
  };
}

function checkChapter(ch: Chapter, index: number): Finding[] {
  const findings: Finding[] = [];
  const title = ch.title;

  if (typeof title !== 'string' || title.trim() === '') {
    findings.push({
      id: `verify-structure-empty-title-${index}`,
      stage: 'structure',
      severity: 'fail',
      type: 'structure-bad-title',
      scope: { chapter_index: index },
      human_message: `Chapter ${index + 1} has no title. Every chapter needs a non-empty title before assemble.`,
    });
    return findings;
  }

  if (title !== title.trim()) {
    findings.push({
      id: `verify-structure-title-whitespace-${index}`,
      stage: 'structure',
      severity: 'warn',
      type: 'structure-bad-title',
      scope: { chapter_index: index, chapter_title: title },
      human_message: `Chapter ${index + 1}'s title has leading or trailing whitespace. Trim it before assemble.`,
    });
  }

  const trimmed = title.trim();

  // All-caps OCR-junk pattern: at least 4 letters, all upper-case.
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) {
    findings.push({
      id: `verify-structure-title-allcaps-${index}`,
      stage: 'structure',
      severity: 'warn',
      type: 'structure-bad-title',
      scope: { chapter_index: index, chapter_title: trimmed },
      human_message: `Chapter ${index + 1}'s title "${trimmed}" is entirely uppercase. That's often residual OCR styling — consider title-casing it.`,
    });
  }

  // Bracket/punctuation junk ratio (e.g. "[??]Title?").
  const junkChars = (trimmed.match(/[\[\]?]/g) ?? []).length;
  if (trimmed.length > 0 && junkChars / trimmed.length > JUNK_BRACKET_RATIO) {
    findings.push({
      id: `verify-structure-title-junk-${index}`,
      stage: 'structure',
      severity: 'warn',
      type: 'structure-bad-title',
      scope: { chapter_index: index, chapter_title: trimmed },
      human_message: `Chapter ${index + 1}'s title "${trimmed}" contains a lot of bracket/question characters — likely OCR junk that needs cleaning.`,
      technical_detail: { junk_ratio: junkChars / trimmed.length },
    });
  }

  return findings;
}

function checkChapterLengths(
  chapters: Chapter[],
  sourceType: StructureFile['source_type'],
): Finding[] {
  const findings: Finding[] = [];
  const lengths = chapters.map((c) => chapterLength(c));
  const total = lengths.reduce((a, b) => a + b, 0);

  if (total === 0) {
    findings.push({
      id: 'verify-structure-all-zero',
      stage: 'structure',
      severity: 'fail',
      type: 'structure-zero-length',
      human_message: `Every chapter has zero length. Either chapter ranges weren't computed, or the source has no extractable text.`,
    });
    return findings;
  }

  // One-giant-chapter check: if a single chapter holds >95% of the body
  // and there are more than one chapter declared, flag it. Skip when source
  // type signals a single-section input is expected (e.g. short URL article).
  if (chapters.length > 1) {
    const maxLen = Math.max(...lengths);
    if (maxLen / total > 0.95) {
      const dominantIdx = lengths.indexOf(maxLen);
      findings.push({
        id: 'verify-structure-dominant-chapter',
        stage: 'structure',
        severity: 'warn',
        type: 'structure-dominant-chapter',
        scope: { chapter_index: dominantIdx },
        human_message: `Chapter ${dominantIdx + 1} holds nearly all the content while ${chapters.length - 1} other chapter(s) are nearly empty. Chapter detection probably misfired — review the splitter.`,
        technical_detail: {
          dominant_index: dominantIdx,
          dominant_share: maxLen / total,
          chapters: chapters.length,
        },
      });
    }
  }

  // Single-chapter case for PDF is suspicious unless explicitly small;
  // we don't have page count here, so warn only when a long PDF compresses
  // to one chapter (>20k length signal) — heuristic, not strict.
  if (sourceType === 'pdf' && chapters.length === 1 && total > 20000) {
    findings.push({
      id: 'verify-structure-pdf-single-chapter',
      stage: 'structure',
      severity: 'warn',
      type: 'structure-dominant-chapter',
      human_message: `This PDF resolved to a single ${total}-unit chapter. If the source has multiple sections, the boundary detector likely missed them.`,
      technical_detail: { total_length: total },
    });
  }

  return findings;
}

function chapterLength(ch: Chapter): number {
  if (typeof ch.length === 'number') return ch.length;
  if (typeof ch.word_count === 'number') return ch.word_count;
  return 0;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const path = getString(args, 'structure');
  const json = hasFlag(args, 'json');
  if (!path) {
    process.stderr.write('verify-structure: --structure=<path> is required\n');
    process.exit(2);
  }
  const result = verifyStructure(path);
  process.exit(emit(result, json));
}
