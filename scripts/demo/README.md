# Demo scripts

The demo/capture script **is** the acceptance test (see `.claude/CLAUDE.md`).
Each `<feature>.ts` here drives the real app in a real browser, asserts the
load-bearing behavior, and leaves screenshots in `out/` as the byproduct.
`<feature>.shots.yml` files are [shot-scraper](https://github.com/simonw/shot-scraper)
workflows for the pure visual frames.

```sh
bun scripts/demo/pwa-shell.ts                        # asserts + evidence
bun scripts/dev.ts &                                 # then, for captures:
shot-scraper multi scripts/demo/pwa-shell.shots.yml
```

The `.ts` scripts use playwright (a devDependency; ships nothing). If
playwright's managed chromium isn't installed, point `PW_CHROMIUM` at any
chromium binary.
