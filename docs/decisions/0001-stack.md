# 0001 — TS + Bun + Hono + SQLite + Drizzle for the desktop server

Date: 2026-05-09
Status: Accepted

## Context

reader-42 has three runtime concerns: a desktop server (library, capture, convert orchestration), a PWA reader (browser-based), and a convert pipeline driven by a headless Claude Code agent. The reader experience is the heart of the product; the convert pipeline is the technically hard part.

The previous iteration (`pdf2epub`) was Python + FastAPI + HTMX. HTMX caps the reader at "good enough"; for a reading product where the reader is core, that's the wrong ceiling.

## Decision

End-to-end TypeScript:

- **Runtime:** Bun (fast, batteries-included, native TS, single binary for tests/scripts/server)
- **Backend:** Hono (small, typed, runs on Bun)
- **DB:** SQLite via better-sqlite3, schema via Drizzle ORM (codegens types)
- **Validation:** Zod at all boundaries (HTTP, file ingest, convert-agent outputs)
- **Frontend:** vanilla TS/HTML/CSS — no React for the reader (see [0003](0003-reader-no-deps.md))
- **Tooling:** Biome for lint+format

## Rationale

- One language across stack — single agent context, single test runner, single dependency manager
- Strong types prevent shape errors; Drizzle and Zod extend that to runtime boundaries
- Bun's speed makes cold scripts (workspace setup, drift-check pipelines) cheap
- SQLite is right-sized: single-user, FTS5 built in for highlight search, one-file backup
- The rest of the convert ecosystem (Marker, Nougat, Calibre tools) lives behind shell calls; the agent invokes them, the server doesn't need to be Python to use them

## Consequences

- Loses Python's conversion-library ecosystem at the server level. The convert agent can still shell to Python tools when installed; it doesn't need the server runtime to be Python.
- Reader code lives in `apps/web/`, written deliberately without EPUB-rendering libraries (see [0003](0003-reader-no-deps.md)).
- Single-binary deployment via `bun build` makes "ship the desktop app as one executable" tractable later.
