# Reviewer brief

Give this to every reviewer, whole. Add the pull request number, its branch, and
the risk areas you drew from its diff.

## Your job

Judgment only. Do **not** run `bun run typecheck`, `bun run lint`, or `bun test`.
CI owns those and reporting them back is noise. Your value is what a machine
cannot check: whether the code does what it claims, whether it honors the
project's own constraints, and whether the tests would notice if it stopped.

Read `docs/decisions.md`, `docs/salvage.md`, `docs/vision.md`, and
`.claude/CLAUDE.md` before you open the diff.

## Every blocking finding carries a failure scenario

Concrete inputs or state, and the wrong output or crash that follows. "This
looks fragile" is not a finding. "Select a word, tap Look up, then swipe left:
`touchend` fires the turn handler with no click event, so the dismissal never
runs and the card stays pinned to a rectangle from the page you left" is.

If you cannot write the scenario, it is a nit or it is nothing.

## Classify every finding

- **blocking**: a defect, a constraint violation, or a test that does not test.
- **nit**: real but not worth holding the pull request for.
- **escalate**: a choice the owner has to make. See below.

## Load-bearing constraints

Derived from `docs/decisions.md`. Check the log yourself; it is appended to and
this table goes stale.

| Constraint | What a violation looks like |
|---|---|
| Zero runtime dependencies in the shipped app | anything in `package.json` `dependencies`; a bare specifier imported from `src/` or `web/` |
| Files are the contract, no server, no database | an endpoint, a schema, a query; anything that makes a device depend on another machine being awake |
| Positions are structural and mode-independent | a pixel offset persisted anywhere; a locator that means something different in paged and scroll mode; geometry resolved against a hidden viewport |
| The reader is built from scratch | an EPUB-rendering library, a framework, a virtual DOM |
| One chapter is the rendering unit | layout that assumes book-wide pixels; progress or locations derived from layout rather than character counts |
| The sidecar owns place, and merges two ways | a third merge rule with no decision entry; scalars merged by union or collections merged by timestamp alone |
| Taste is device-local, place is synced | typography, theme, display mode, or measured pace written into `book.json` |
| Bundled assets ship in the repo | a CDN reference, a fetch on first run, a post-install step for anything reading depends on |
| One acceptance suite, and CI runs all of it | a demo or check script outside `package.json` and outside CI; a second verification convention beside the suite |
| Reading never needs the network | a read path that reaches the network before the device cache |

## Salvage lessons

`docs/salvage.md` records what the previous implementation cost to learn. Say in
your report which of these you checked against this diff, and which do not apply.

- Overlay `<mark>` wrappers must be invisible to locator paths.
- Adopt, do not clone: `importNode` never drains the source and loops forever.
- Paged mode is CSS columns that must overflow the host, stride equal to
  `clientWidth`, or pagination dies silently at zero pages.
- Parse chapters as XHTML first with a `text/html` fallback, namespace-aware.
- Read the display mode at call time, not at closure creation.
- Progress is length-weighted; chapter-count weighting lies.
- The end of the last chapter reports progress 1.
- Highlights wrap each intersecting text node separately; `surroundContents`
  throws across element boundaries.
- Sanitize persisted locators at load; foreign data degrades, never crashes.

## Product laws

`docs/vision.md`. Use them for judgment calls, not as a checklist. The two that
catch the most: resume is under a second on any device, and the phone is a
reading surface rather than a port.

## Do the tests test anything?

For every test the diff adds or touches, ask what would have to break for it to
fail. If the answer is "nothing this pull request could plausibly do", say so.
A green assertion that tests nothing is worse than a missing one, because it
reads as coverage.

Look hardest at assertions near the code that needed fixing. Vacuous assertions
cluster there, because both come from the same misunderstanding.

## Escalate, do not resolve

Stop and flag when a pull request:

- resolves a question `docs/decisions.md` has not answered
- overturns a recorded decision
- changes how the reader feels or looks where a live alternative exists
- adds a durable refusal that belongs in `docs/non-goals.md`

Load-bearing choices are the owner's. Say what the pull request chose, what the
alternative was, and what it costs either way.

## Say what you could not judge

Name explicitly what a diff cannot tell you: whether it renders correctly,
whether a race is real, whether a fixture matches production data. That list is
what tells the orchestrator to go run it.

## Report format

```
## #<n> <title>

**Verdict:** land | land-with-fixes | blocked

### Blocking
- `file.ts:LINE`, what is wrong. Failure: <concrete scenario>.

### Nits
- `file.ts:LINE`, what and why.

### Escalate
- <the choice made, the alternative, what it costs>.

### Salvage lessons checked
- <which applied, which did not>

### What I could not judge from the diff
- <the list>

### Proposed pull request body
<the rewrite, in the style below>
```

## Pull request body style

The body is a permanent record. The author's self-critique is useful review
input and does not belong in it.

- What changed, why, how verified. Nothing else.
- No em-dashes. No "Stack N of M". No line or file counts; GitHub renders those.
- No instructions to the reviewer, no theatrical framing, no "this is the
  weakest layer".
- No `Generated by Claude Code`, no trailers of any kind.
- No version framing, no competitor naming.
- Do not invent verification that did not happen. Name the checks that ran and
  the scenes that cover it.
- Disclose known defects rather than hiding them, and point at what fixes them.
