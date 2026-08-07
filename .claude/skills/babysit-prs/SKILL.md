---
name: babysit-prs
description: Review, fix, and land open pull requests in reader-42. Confirms the gates are real, reviews against the project's own constraints, applies fixes, rewrites the body, attaches evidence, and merges. Use when asked to review a PR, land a PR, or babysit a stack of PRs.
---

# Babysitting pull requests

Agentic implementation outruns human review. This skill is the other half: an
agent that reviews, fixes, and lands what another agent wrote, without lowering
the bar to manufacture throughput.

The order is **review, then land**. Nothing merges before it has been read.

## Before anything else: are the gates real?

Ask this on every run, first, and never assume it:

```bash
gh api repos/:owner/:repo/actions/workflows --jq '.total_count'
gh pr checks <n>
```

A workflow file in the tree is not a registered workflow, and a pull request
with no check runs is not a passing pull request. On the run this skill came
from, fourteen pull requests carrying thirteen thousand lines showed empty
checks because the workflow existed only on branches GitHub had never seen.
Everything downstream of that discovery was worthless until it was fixed.

If the gates are not running: verify the base branch is green locally first,
then land the workflow, then confirm a real run went green before reviewing
anything. Making a gate mandatory over a red base branch blocks everything.

**Absence of red is not green.** `gh pr checks` reports "no checks reported"
cheerfully, and a branch pushed before CI existed will never have any. Treat
that as a stop condition.

## The default path: one pull request

Most of the time this is the whole job.

1. **Confirm the gates.** Above.
2. **Review it.** One reviewer against `references/reviewer-brief.md`. For a
   diff you can hold in one context, do it yourself rather than delegating.
3. **Drive it, if it renders anything.** Run `bun run demo` and look at the
   frames. Do not skip this because the suite is green: a passing assertion
   hid a control clipped in half on the run this came from. See
   "Driving beats reading" below.
4. **Fix what you found.** `references/fixer-brief.md`. Fixes go on the branch
   under review, one commit per fix.
5. **Rewrite the body.** What changed, why, how verified. Style rules in the
   reviewer brief.
6. **Attach evidence** if it touches user-visible behavior. See
   `references/landing.md`.
7. **Land it** with the three guards in `references/landing.md`.

## The escalation: more than about three dependent pull requests

A stack, or any set too large to hold in one context, needs the machinery
below. The trigger is dependency, not size: three independent pull requests are
three runs of the default path.

**Phase 1, fan out.** One reviewer per pull request, all reading the same
brief, each prompt hand-specialized with that pull request's known risk areas
drawn from the diff and from what the author admitted in the body.

- **Pass `isolation: "worktree"` when you invoke the agent.** Writing "you are
  in your own worktree" into the prompt does nothing. This was got wrong once
  and thirteen reviewers ran `git checkout` in the owner's working tree.
- Reviewers check out `--detach <ref>`, never a branch. Detached refs let two
  agents sit on the same commit; a branch checkout collides.
- Cap concurrency and make the run resumable. Write every report to a durable
  ledger as it arrives rather than holding them in context. Session limits
  killed four agents on the original run and nothing was lost because of this.
- Run in two waves when layers build on each other: foundational layers first,
  then the rest, seeded with what wave one found.
- Restore the owner's working tree and prune stray worktrees afterwards.

**Phase 2, the whole-stack pass.** One reviewer reads the cumulative diff
against the project's constraints. This is not optional and not a nicety.
Twelve per-pull-request reviewers each correctly reported "no pixel locators"
against their own diff and all twelve were wrong globally, because the field
was introduced in one layer and made mode-dependent by another. Constraint
violations assembled across layers are invisible to every local view.

**Phase 3, reconciliation.** Yours alone, and real work. Reviewers contradict
each other and some of them are wrong. On the original run this changed five
verdicts in both directions: a reviewer's count of orphan scripts was wrong,
another's tap-target finding was already fixed under a media query, and a
pull request's claim that a later layer fixed its duplication was false.

- Empirical results outrank static reading. The agent that ran the suite beats
  the agent that read the diff.
- An unverified finding from a sibling reviewer is a lead, not a fact.
- When several reviewers report the same symptom at different layers, they are
  usually seeing parts of one defect. Assemble it before acting.
- "Fixed in a later layer" is a claim to verify, exactly like any other.

**Phase 4, the fix pass.** See `references/fixer-brief.md`. Fixes land as one
layer on top rather than distributed downstack, unless the stack is small.
Distributing means rebasing every layer above the fix, across exactly the files
that generated the defects. Measure it before deciding: on the original run,
five of forty-five fixes touched files a single layer touched, and twenty-four
touched files that ten or more layers touched.

**Phase 5, land bottom-up.** `references/landing.md`.

## Driving beats reading

For any pull request with a rendering surface, an agent must run the acceptance
suite and look at the frames. On the original run this found, in one pass, a
control clipped to "Hea" instead of "Heavy" behind a green assertion, an
annotation layer completely inert on touch, and three demo scripts nothing ran.
The suite takes about two minutes, which changes the economics entirely.

Derive a missing-assertion finding from every visual defect found this way. A
defect that shipped past a green suite means the suite has a hole, and the hole
is the more valuable finding.

## Assertions are hypotheses

An assertion proposed in a review finding is a guess about what is observable,
and layout does not respect guesses. Three vacuous assertions turned up on the
original run, each written by someone reasoning correctly about behavior and
wrongly about which observable changes.

**Require the fail-first proof for every assertion, including your own.** Mask
the fix, run, confirm red, paste the output, restore. "Assertion added, suite
green" is not evidence of anything.

## What escalates to the owner

Load-bearing choices are the owner's (`.claude/CLAUDE.md`). Agents implement
against them and never mint them silently. A fix pass mints decisions the same
way an implementation pass does, because the fix has to choose something.

Route to the owner, do not resolve:

- anything that changes how the reader feels or looks and has a live alternative
- a pull request that resolves a question the decision log has not answered
- anything that overturns a recorded decision
- a refusal that belongs in `docs/non-goals.md`

Collect these in one queue with the choice made and the alternative rejected,
and hand it over as drafts in the owner's voice for them to edit or reject.

## Report blockage plainly

If a stack is blocked at layer two because layer two mints decisions the owner
has not made, the honest report is "one landed, thirteen blocked, plus a fix
pass". An escalation that stalls a stack is the process working. Never
manufacture throughput by lowering the bar.

## References

| For | See |
|---|---|
| What a reviewer is given | `references/reviewer-brief.md` |
| What a fixer is given | `references/fixer-brief.md` |
| Merging, rebasing, evidence | `references/landing.md` |
