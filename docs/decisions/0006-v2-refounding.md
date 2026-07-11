# 0006 — v2 re-founding: owner as architect, revised telos, rewrite planned

Date: 2026-07-11
Status: accepted (by merge of the PR introducing this ADR)
Supersedes: parts of 0005 (scope holds; telos and operating model revised)

## Context

v1 (M1–M4) shipped a working library + reader + highlights app (~5.6k lines), built almost entirely by agents against telos docs, reviewed via milestone evidence packs. The outcome was on-vision but left the owner without a mental model of the code — behavior was verified, acquaintance was never transferred. Separately, the owner's ambition grew: reader-42 is now understood explicitly as an instrument of environment design (reading as keystone habit, displacing algorithmic slop), with productization — "Plex for books" — a live option rather than a refusal.

## Decision

1. **The owner owns the architecture.** Concept, contract, and stack decisions are made by the owner and recorded as ADRs; agents implement against them. Review moves from screenshots-only evidence packs to architecture-level review with code contact.
2. **The telos is revised** (vision.md v2): product laws — win the boredom moment, friction asymmetry, guided by beauty, phone as first-class surface — outrank feature lists. Most v1 non-goals become pipeline ideas (`pipeline.md`); only durable refusals remain in `non-goals.md`.
3. **A ground-up rewrite is planned** as the ownership-transfer mechanism. v1 stays alive as the reference implementation; its lessons (structural locator family, shadow-DOM rendering traps, demo-script-as-acceptance-test) are salvaged into a written audit before v2 code starts.
4. **No MCP server.** Agent access to the library is plain documented API endpoints plus a query skill. Same capability, no novelty budget spent on protocol plumbing.

## Consequences

- Sequencing: telos (this PR) → salvage audit of v1 → owner's architecture ADRs (stack, deps policy, data model, offline-first, repo topology) → incremental rebuild starting from the reader core and boredom-moment features.
- The roadmap will be rewritten after the architecture ADRs; v1's roadmap remains as historical record until then.
- Nothing in v1 is deleted or destabilized while v2 grows.
