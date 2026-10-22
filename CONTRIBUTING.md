# Contributing to BlinkTransfer

Thanks for wanting to help. This project is maintained by one person, so a
little structure goes a long way.

## Getting set up

```bash
git clone https://github.com/drsamonline/BLINKTRANSFER.git
cd BLINKTRANSFER
npm install
npm test        # run the test suite
npm run lint    # lint
npm run dev     # dev server on http://localhost:3000
```

The dev server serves the app from `docs/play/`. `npm run build` writes the
production bundle there too.

## Ways to help

- **Bug reports** — please include your browser/OS, what you sent, and the
  receiver's console output if you can.
- **Scanning reliability** — the most useful field reports are "this phone, this
  lighting, this distance". Screenshots and short clips are gold.
- **Pull requests** — keep them focused. One change per PR.

## Ground rules

- Run `npm test` and `npm run lint` before opening a PR; both must pass.
- Add or update tests for anything in `src/lib/` — that is where the logic lives
  and it is all covered by `node --test`.
- Match the existing code style (2-space indent, ES modules, no framework).
- Do not add a runtime dependency unless it is genuinely necessary; the
  transport is meant to stay dependency-light.

## Licence of contributions

By contributing you agree that your contributions are licensed under the same
terms as the project (see `LICENSE`), and you confirm you have the right to
submit them.

## Code of conduct

Participation is covered by our [Code of Conduct](CODE_OF_CONDUCT.md).
