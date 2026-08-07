# Fixer brief

Give this to every agent applying a reviewed fix pass, with the findings it
owns appended.

## A fix pass is a second detector

Fixing a defect forces you through the code path at a depth review does not
reach, and the acceptance suite catches the consequences. Budget for finding new
bugs and report them rather than absorbing them silently. On the run this came
from, three bugs no reviewer named were found this way: a character fraction fed
into an extent that ends at the last page's start, a resize restoring the
reader's place after the reflow rather than before it, and a lowercase
conversion that grows a character and desynchronizes search offsets.

## The rules that earned their keep

**A task list, not a task sequence.** Order the work yourself and report the
ordering you chose. The dependency structure between fixes is often only visible
from inside the code. On the original run, wave one deleted a byte-approximation
weighting model before deriving reporting from characters, because the second
fix is unsound while the first model can still silently be in play.

**Every test must fail before the change.** Stash the source, run, confirm red,
restore. Paste the red output in your report. A fix plus a test written against
the fixed behavior proves nothing. This applies to assertions a finding
prescribes, too: those are hypotheses about what is observable, and layout does
not respect hypotheses.

**App or scene, for every failing assertion.** When a scene fails, state
explicitly whether the application was wrong or the assertion was. Never edit an
assertion to get green without saying so and why. If a failing assertion turns
out to have always been vacuous, say that: it is the more valuable finding, and
vacuous assertions cluster around the code that needed fixing.

**You may decline, with a reason.** A fixer that attempts everything on the list
produces a diff nobody can review, which is how a fix pass becomes the thing it
was cleaning up after. Declining a seven-module refactor and doing the five
hand-copied close lists was the right split on the original run.

**Report every user-visible choice you had to make.** A fix has to choose
something, and choices about how the reader feels or looks belong to the owner
(`.claude/CLAUDE.md`: never mint decisions silently). List the choice and the
alternative you rejected. "It was only a fix" is not an exemption.

**Report any timing you touched.** Say explicitly whether you added, removed, or
changed a wait or timeout in `scripts/demo/scenes.ts` or `scripts/demo/harness.ts`.
Silently inserting waits to get green buries a real race.

## Commit discipline

One commit per fix or per tight group. Conventional, single-line, no trailers,
no `Co-Authored-By`. Never cross a fix boundary with a dirty tree: finish, verify,
commit, then start the next. Sessions end without warning and everything
uncommitted is lost.

## Working area

Work in your own worktree, never in the owner's checkout, and never run
`git checkout` outside it. Do not push. Do not create pull requests.

Run `git status` and `git log --oneline -5` first and report what you find. If a
previous agent left uncommitted work, inspect it and say whether you kept or
discarded it, and why.

## Verify

```
bun run typecheck && bun run lint && bun test
bun run demo
```

All must pass. `timeout` does not exist on macOS; do not wrap commands in it.

## Report

Under 600 words: what changed, the commits, the fail-first proofs with their red
output, every user-visible choice and its rejected alternative, any timing you
touched, what you skipped and why, and the verification output.

If a fix is wrong or riskier than the finding described, do not force it. Say so
and leave it.

## Sizing a wave

Size by the number of files the agent must hold in mind, not by the number of
findings. A group that rewrites one stylesheet and one scene file is one agent's
work; a group that also rewrites the harness is two. Group D of the original run
took 111 tool calls on its own.

Establish and verify a green baseline yourself before handing over the worktree,
and say it is green. Otherwise the first red the fixer sees is ambiguous and it
spends its context deciding whose it is.
