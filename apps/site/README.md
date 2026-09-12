# ashfox Public Site

This workspace builds the landing page and documentation in each registered
language: `/` and `/docs/` in English, `/ko/` and `/ko/docs/` in Korean.

- Landing and interactive interface copy lives in `src/messages/<locale>.json`.
- Technical documentation is read from the repository `docs/` directory.
- The site imports no product or engine package.
- `dist/` contains the site fragment consumed by `npm run build:public`.

The copied agent instruction points to the selected language’s asset workflow guide.
See [localization maintenance](../../docs/contributing/localization.md) to add a language.
Canonical and social metadata use `https://ashfox.io`.

The landing uses a framed live-model hero, a three-part output index (GLB, PNG,
WAV), and distinct pixel and sound showcases. The final call to action returns
to the existing agent setup in the hero. All previews use actual exported assets;
keyboard access, reduced motion and the model failure poster remain supported.
The source panel shows its excerpt immediately in a fixed-height, keyboard-scrollable
code area. Switching model, item and sound tabs preserves the panel height; there
is no expanding disclosure that shifts the surrounding section.
Run `npm --workspace @ashfox/site run test:browser` for interaction and responsive
checks alongside `npm run test:site` for localized pages and public links.

Creature replay links open one shared modal with a titled video, native playback
controls and a direct-file fallback. Closing with the close button, Escape or
backdrop stops and unloads playback, restores focus to the opening link, and
preserves gallery layout. Videos never autoplay. Without JavaScript the links
open the MP4 directly. The modal traps keyboard focus through native dialog
behavior and prevents background scrolling.

The sound showcase exports `examples/sounds/src/bird_call.ashfox` through the CLI
as `bird-base.wav` and `bird-alternate.wav`, with waveforms derived from those
exact files. Playback, variation, downloads and the source tab refer to this same
source. The claw-hit example remains available in the sound collection and guides.
