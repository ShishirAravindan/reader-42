/**
 * Tests for drift-check. Inline fixtures stay small so we don't ship binary
 * artifacts. Cases cover: clean conversion (pass), length-ratio fail, missing
 * href (structural fail), hallucination (inverse coverage fail).
 */

import { describe, expect, test } from 'bun:test';
import { driftCheck } from './drift-check.ts';

describe('drift-check', () => {
  test('clean conversion passes all sub-checks', () => {
    const raw = `<article>
      <h1>The Bitter Lesson</h1>
      <p>Methods that leverage compute and learning beat methods that bake in human knowledge. Researchers repeatedly try to build their understanding into systems and are repeatedly outpaced by general approaches that scale with available compute.</p>
      <p>The lesson applies to chess, to speech recognition, to vision, and now to language. Each domain followed the same arc: clever, hand-tuned heuristics gave way to learning-from-data, which then gave way to learning-with-search-and-scale.</p>
      <p>Read the <a href="https://example.com/sutton">original essay</a> for the full argument and historical examples.</p>
    </article>`;
    const cleaned = `<h1>The Bitter Lesson</h1>
      <p>Methods that leverage compute and learning beat methods that bake in human knowledge. Researchers repeatedly try to build their understanding into systems and are repeatedly outpaced by general approaches that scale with available compute.</p>
      <p>The lesson applies to chess, to speech recognition, to vision, and now to language. Each domain followed the same arc: clever, hand-tuned heuristics gave way to learning-from-data, which then gave way to learning-with-search-and-scale.</p>
      <p>Read the <a href="https://example.com/sutton">original essay</a> for the full argument and historical examples.</p>`;

    const result = driftCheck({ raw, cleaned, mode: 'html' });
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.sub_results.length_ratio.status).toBe('pass');
    expect(result.sub_results.ngram_fwd.status).toBe('pass');
    expect(result.sub_results.ngram_inv.status).toBe('pass');
    expect(result.sub_results.structural.status).toBe('pass');
    expect(result.sub_results.judge.status).toBe('skipped');
  });

  test('length ratio failure when cleaned is dramatically shorter', () => {
    const raw = Array.from({ length: 30 }, (_, i) =>
      `Distinctive paragraph number ${i} about systems thinking, leverage points, scale, and the design of feedback loops in adaptive organizations.`,
    ).join('\n\n');
    const cleaned = 'Tiny stub.';

    const result = driftCheck({ raw, cleaned, mode: 'text' });
    expect(result.status).toBe('fail');
    expect(result.sub_results.length_ratio.status).toBe('fail');
    const lengthFinding = result.findings.find((f) => f.id.startsWith('drift-length'));
    expect(lengthFinding).toBeDefined();
    expect(lengthFinding?.severity).toBe('fail');
    expect(lengthFinding?.stage).toBe('cleanup');
    expect(lengthFinding?.type).toBe('drift');
    expect(lengthFinding?.human_message.length).toBeGreaterThan(20);
  });

  test('missing href triggers structural fail', () => {
    // Same content but the cleaned version drops every hyperlink.
    const raw = `<article>
      <p>See <a href="https://example.com/a">link A</a>, <a href="https://example.com/b">link B</a>, <a href="https://example.com/c">link C</a>, and <a href="https://example.com/d">link D</a> for context. The body of the article continues here with a great deal of additional discussion that fills out the length and gives the n-gram check enough to chew on, including details and examples and arguments and analogies and references that survive cleanup intact.</p>
      <p><img src="https://example.com/diagram.png" alt="diagram"/> The diagram above illustrates the point.</p>
    </article>`;
    const cleaned = `<p>See link A, link B, link C, and link D for context. The body of the article continues here with a great deal of additional discussion that fills out the length and gives the n-gram check enough to chew on, including details and examples and arguments and analogies and references that survive cleanup intact.</p>
      <p>The diagram above illustrates the point.</p>`;

    const result = driftCheck({ raw, cleaned, mode: 'html' });
    expect(result.sub_results.structural.status).toBe('fail');
    expect(result.status).toBe('fail');
    const structFinding = result.findings.find((f) =>
      f.id.startsWith('drift-structural'),
    );
    expect(structFinding).toBeDefined();
    expect(structFinding?.severity).toBe('fail');
    const detail = structFinding?.technical_detail as
      | { missing_hrefs?: string[]; missing_srcs?: string[] }
      | undefined;
    expect(detail?.missing_hrefs?.length).toBeGreaterThanOrEqual(4);
    expect(detail?.missing_srcs?.length).toBeGreaterThanOrEqual(1);
  });

  test('hallucinated content triggers inverse coverage fail', () => {
    // Cleaned version invents content that does NOT appear in raw. Length
    // stays in range so length_ratio doesn't dominate; the inverse coverage
    // check is what catches hallucination.
    const raw = `Quantum field theory describes elementary particles as excitations of underlying fields. The Standard Model unifies electromagnetism, the weak force, and the strong force, leaving gravity outside its scope and motivating ongoing work in quantum gravity research.`;
    const cleaned = `Penguins waddle across icy plains in tightly-packed colonies. Emperor penguins migrate hundreds of kilometers each austral winter to breeding grounds on stable sea ice, where males incubate single eggs through brutal blizzards while females hunt at sea.`;

    const result = driftCheck({ raw, cleaned, mode: 'text' });
    expect(result.sub_results.ngram_inv.status).toBe('fail');
    expect(result.status).toBe('fail');
    const invFinding = result.findings.find((f) =>
      f.id.startsWith('drift-ngram-inv'),
    );
    expect(invFinding).toBeDefined();
    expect(invFinding?.severity).toBe('fail');
    expect(invFinding?.human_message).toContain('hallucinated');
  });

  test('text mode skips structural check', () => {
    const raw = 'Some plain text content for a PDF chapter that has no markup at all but plenty of words to fill the buffer for the n-gram coverage check to operate over distinctive phrases like underground caverns, stratified rock, and sediment dynamics.';
    const cleaned = raw;
    const result = driftCheck({ raw, cleaned, mode: 'text' });
    expect(result.sub_results.structural.status).toBe('skipped');
    expect(result.sub_results.judge.status).toBe('skipped');
    expect(result.status).toBe('pass');
  });
});
