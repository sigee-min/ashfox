# Publishing Ashfox documentation

For contributors maintaining the Ashfox documentation site, generated examples and
shared-link previews. For building assets with Ashfox, see the [user guides](../README.md).


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

The landing's GLB viewer is maintained in `scripts/landing/viewer.js`.
`scripts/landing/build.js` exports its portable GLB, native PNGs and WAV variants
through the CLI, generates waveforms from the WAV samples, and bundles the viewer.
The site consumes generated assets and does not import engine or renderer packages.
Run the site browser test for desktop, mobile, reduced motion and load-failure
fallback behavior. Public controls use user-facing actions rather than variant IDs.

Landing entrance and selection transitions live in `apps/site/src/motion.js`.
Content remains visible without animation. Reduced motion cancels active transitions;
scroll reveals run once and the sound pulse follows actual playback state.

## README item and sound media

The README reuses the rendered sword and sound waveform in `assets/docs/`.
Run `npm run build:cli` and `node scripts/showcase/readme.js` to regenerate the native
sword/amethyst PNG downloads and enlarged amethyst preview in `assets/readme/`.
Preview images are for display; the linked native PNGs are the game textures.
Sound playback links to the public landing player because GitHub README audio
embedding is not assumed. The WAV link remains available as a file download.

## Shared-link previews

Landing and Docs use separate 1200×630 PNG social cards. Run
`npm run build:cli` and `node scripts/showcase/social.js` with Chrome available (or set
`ASHFOX_CHROME_PATH`) to regenerate them from the versioned layout and the real
Griffin source. Review both images before committing. The generator owns
`apps/site/public/og.png` and `og-docs.png`; the site build publishes content-hashed
copies and uses absolute URLs for Open Graph and Twitter cards. Changed image
bytes get a new URL; external services may still require refreshing cached page
metadata for links shared before the update.

## Languages

See [documentation localization](localization.md) for the locale registry, translation
revision workflow, shared code examples, fallback behavior and verification.
