# Documentation delivery

Public user pages are selected exclusively by `docs/public.json`. Keep repository
setup, build ownership and contributor commands in this directory or CONTRIBUTING.
User guides use the installed local command `npx --no-install ashfox`.

The site build runs `scripts/docs/build.js` to package the self-contained CLI and
complete starter/project/client/game downloads. No registry publication is needed.
Run `node scripts/docs/media.js` after rebuilding the CLI to regenerate guide
images, GIF and WAV; `assets/docs/receipt.json` records sources, commands and hashes.
The public site copies media but not that internal receipt.

Run `npm run test:site`, `npm run test:docs:capture`, CLI documentation tests and
`npm run build:public`. Real media generation requires Chrome/Chromium. The public
web-game example is tested from its downloadable ZIP, not from private packages.

To build a CLI package alone: `npm run build:cli`, then
`npm pack --workspace @ashfox/cli --pack-destination /path/to/packages`.
