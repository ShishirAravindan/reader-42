# Acceptance evidence: the kindle-parity stack

Frames produced by `bun run demo` at the top of the stack (`stack/14-review-pass`),
21 scenes, all passing. Kept on their own branch so pull request bodies can show
them inline without putting binaries into the history of `dev` or `main`.

The assertions are the test; these are the byproduct. CI re-runs the same suite on
every pull request and uploads the same frames as the `acceptance-evidence` artifact.

`showcase.gif` is the end-to-end walkthrough recorded by `scripts/demo/showcase.ts`
against the `dev` tip: the real app, driven through the reading act, captions and
tap markers injected by the script rather than added afterwards. Sped up, and
reduced to a size that plays inline in a pull request.
