# Landing

Merging is where an unverified state most easily passes for a verified one.
Every guard here exists because it was missing once.

## The three guards

**Fail on the real exit code.** `git rebase ... | tail -2` reports `tail`'s
status, so `set -e` never fires and the script sails past a conflict into the
merge. Two pull requests merged with no CI because of this. Capture to a log and
tail the log; never pipe a command whose failure must stop the run.

**Check runs must exist before you read them.** `gh pr checks` says "no checks
reported" for a branch pushed before CI existed, and that reads as absence of
red. Poll until check runs appear on the head SHA, then watch them:

```bash
for i in $(seq 1 60); do
  n=$(gh api "repos/:owner/:repo/commits/$SHA/check-runs" --jq '.total_count')
  [ "$n" -gt 0 ] && break
  sleep 10
done
gh pr checks "$PR" --watch --fail-fast
```

**Verify the pushed head is what you rebased.** A rebase that stops mid-conflict
does not move the branch ref, so the force-push succeeds as a no-op and the
merge proceeds against unrebased content. Compare the SHA you rebased to the one
the pull request reports.

## Rebasing a stack

A plain `git rebase origin/dev` on layer N+1 tries to replay layer N's commits,
which conflict with layer N's own squash commit already on `dev`. The squash
commit is not an ancestor of anything above it. Replay only that layer's own
commits:

```bash
git rebase --onto origin/dev <layer-N-tip> <layer-N+1-branch>
```

Which means **the whole stack's branch tips must be snapshotted as SHAs before
anything merges**, because merging deletes the branches those SHAs came from.

Two more, both learned the hard way:

- Do not merge while a fan-out is in flight. Review is a snapshot of a base;
  merging under it invalidates every report still being written, and the next
  layer's diff re-shows already-merged content until it is rebased.
- A worktree holding a branch blocks checking it out anywhere else. Remove
  review and fix worktrees before landing.

## The conflict you will get

An append-only log is the most likely conflict in a stack and the worst one to
resolve carelessly. Two branches that both append to `docs/decisions.md` collide
at the end of the file, and "take theirs" silently deletes a decision.

Keep every entry from both sides and restore chronological order by the dates in
the headings. Say in the report which entries came from which side.

## Evidence

The definition of done wants a capture on every pull request touching
user-visible behavior, and a merge into `main` carries an end-to-end demo.

Screenshots cannot be attached to a body through the API; only the web interface
uploads to GitHub's own host. Use an orphan branch:

```bash
git init -b evidence/<topic> && git commit && git push
```

Frames linked by `raw.githubusercontent.com` render inline in every body and
never touch the history of `dev` or `main`. A recording works the same way once
it is a gif small enough to play inline; `scripts/demo/showcase.ts` produces the
walkthrough and `ffmpeg` reduces it.

**Stand the evidence branch up at the start of a run, not the end.** The frames
already exist as a byproduct of `bun run demo`. What is missing is a URL, and
without one the definition of done quietly goes unmet on every pull request.

## Things GitHub will not let you undo

- **Pull request numbers cannot be reissued.** They come from one sequence
  shared with issues, and closing or deleting never frees one.
- **Renaming a branch closes any open pull request whose head it is**, and a
  closed pull request whose head branch no longer exists cannot be reopened at
  all, which strands the number permanently.

Reusing a specific number means reopening the original pull request, retargeting
its base, and force-moving its head, and living with the original branch name.
Ask the owner before opening anything if the numbering matters, because
afterwards every remedy is ugly.

## After the stack is down

- Verify the base branch locally: typecheck, lint, unit tests, and the suite.
- Require the CI contexts on the base branch so the gate is enforced rather than
  merely present.
- Delete merged branches, locally and remotely, and prune worktrees.
- Restore the owner's working tree to the branch it was on.
- Close pull requests the stack superseded.
