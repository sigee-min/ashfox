import { landingContent } from '../content.mjs';
import {
  absoluteUrl,
  escapeHtml,
  githubIconButton,
  githubUrl,
  pageShell
} from './shell.mjs';

const landingShowcase = ({ content, showcase }) => {
  const entries = content.entries.map((copy) => {
    const generated = showcase.entries.find((entry) =>
      entry.packageName === copy.packageName &&
      entry.entryName === copy.entryName
    );
    if (!generated) {
      throw new Error(
        `Landing showcase is missing ${copy.packageName}/${copy.entryName}.`
      );
    }
    return { ...generated, ...copy };
  });
  if (entries.length !== showcase.entries.length) {
    throw new Error('Landing showcase content must label every generated entry.');
  }
  const first = entries[0];
  if (!first) throw new Error('Landing showcase requires one generated entry.');
  const replayAlt = (entry) =>
    `Reconstructed build replay of ${entry.label} from an empty scene through geometry, textures, motion, and the complete model.`;

  return `
    <div
      class="hero-visual replay-showcase"
      id="examples"
      data-replay-showcase
      data-replay-state="poster"
    >
      <figure class="replay-window" aria-describedby="replay-provenance">
        <div class="replay-toolbar">
          <span class="replay-status"><i aria-hidden="true"></i>${escapeHtml(content.eyebrow)}</span>
          <button
            class="replay-toggle"
            type="button"
            data-replay-toggle
            aria-controls="showcase-player"
            aria-pressed="false"
            aria-label="Play ${escapeHtml(first.label)} build replay"
          >
            <span aria-hidden="true" data-replay-toggle-icon>▶</span>
            <span data-replay-toggle-label>Play replay</span>
          </button>
        </div>
        <div class="replay-media" id="showcase-player">
          <img
            class="replay-poster"
            src="${escapeHtml(first.posterSrc)}"
            data-replay-poster
            width="${showcase.capture.width}"
            height="${showcase.capture.height}"
            alt="${escapeHtml(replayAlt(first))}"
            decoding="async"
            fetchpriority="high"
          >
          <img
            class="replay-player"
            data-replay-player
            width="${showcase.capture.width}"
            height="${showcase.capture.height}"
            alt=""
            decoding="async"
            aria-hidden="true"
            hidden
          >
          <span class="replay-corner replay-corner-top" aria-hidden="true"></span>
          <span class="replay-corner replay-corner-bottom" aria-hidden="true"></span>
        </div>
        <figcaption class="replay-caption">
          <div class="replay-caption-copy">
            <span data-replay-active-position>${escapeHtml(first.index)} / 0${entries.length}</span>
            <strong data-replay-active-name>${escapeHtml(first.label)}</strong>
            <p data-replay-active-summary>${escapeHtml(first.summary)}</p>
          </div>
          <div
            class="replay-selectors"
            role="group"
            aria-label="Choose a build replay"
          >
            ${entries.map((entry, index) => `
              <button
                type="button"
                data-replay-select
                data-replay-src="${escapeHtml(entry.replaySrc)}"
                data-poster-src="${escapeHtml(entry.posterSrc)}"
                data-package-name="${escapeHtml(entry.packageName)}"
                data-entry-name="${escapeHtml(entry.entryName)}"
                data-label="${escapeHtml(entry.label)}"
                data-summary="${escapeHtml(entry.summary)}"
                data-position="${escapeHtml(entry.index)} / 0${entries.length}"
                data-alt="${escapeHtml(replayAlt(entry))}"
                aria-pressed="${index === 0 ? 'true' : 'false'}"
                aria-label="Select ${escapeHtml(entry.label)} build replay"
              ><b>${escapeHtml(entry.index)}</b>${escapeHtml(entry.label)}</button>
            `).join('')}
          </div>
        </figcaption>
      </figure>
      <p class="replay-provenance" id="replay-provenance">${escapeHtml(content.provenance)}</p>
      <div class="replay-actions">
        <a class="button button-primary" href="${escapeHtml(showcase.workspaceHref)}" download>
          Download workspace
          <span aria-hidden="true">↓</span>
        </a>
        <a class="button button-secondary" href="${escapeHtml(showcase.griffinGlbHref)}" download>
          Download Griffin GLB
          <span aria-hidden="true">↓</span>
        </a>
        <a class="button button-secondary" href="${escapeHtml(showcase.workbenchHref)}">
          Launch Workbench
          <span aria-hidden="true">↗</span>
        </a>

      </div>
    </div>
  `;
};

export const renderLandingPage = ({ assets, config, showcase }) => {
  const content = landingContent;
  const body = `
    <main id="main">
      <section class="hero" id="quick-start">
        <div class="hero-copy">
          <p class="eyebrow"><span></span>${content.eyebrow}</p>
          <h1>${content.titleLines
            .map((line) => `<span>${escapeHtml(line)}</span>`)
            .join('')}</h1>
          <p class="hero-summary">${content.summary}</p>
          <div class="hero-actions">
            <button
              class="button button-primary hero-copy-action"
              type="button"
              data-copy-agent-instruction
              data-instruction="${escapeHtml(content.quickStart.instruction)}"
            >
              <span
                data-copy-state
                data-default-state="Copy for your AI agent"
                data-copied-state="Copied — paste into your agent"
              >Copy for your AI agent</span>
              <span aria-hidden="true">↗</span>
            </button>
            <a class="button button-secondary" href="#examples">Watch the build <span>↓</span></a>
            ${githubIconButton('hero-github')}
          </div>
          <p
            class="hero-agent-hint"
            data-copy-feedback
            data-default-feedback="Paste into a browser-capable AI agent, then describe what you want."
            aria-live="polite"
          >Paste into a browser-capable AI agent, then describe what you want.</p>
          <details class="setup-disclosure">
            <summary>View instruction</summary>
            <pre><code>${escapeHtml(content.quickStart.instruction)}</code></pre>
          </details>
        </div>
        ${landingShowcase({ content: content.showcase, showcase })}
      </section>

      <section class="section output-section" id="outputs">
        <div class="output-copy" data-reveal>
          <p class="eyebrow"><span></span>Export</p>
          <h2>Take it into your game.</h2>
          <p>Save your workspace to keep editing. Export the model in the format your project uses.</p>
          <a class="text-link" href="/docs/guides/save-and-export/">Save and export <span>→</span></a>
        </div>
        <div class="format-grid">
          ${content.formats.map(([name, description], index) => `
            <a class="format-card" href="/docs/guides/choose-a-format/" data-reveal>
              <span>0${index + 1}</span>
              <div><strong>${name}</strong><p>${description}</p></div>
              <b aria-hidden="true">↗</b>
            </a>
          `).join('')}
        </div>
      </section>

    </main>
  `;
  return pageShell({
    active: 'product',
    assets,
    body,
    config,
    description: content.summary,
    path: '/',
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          name: 'ashfox',
          url: absoluteUrl(config.siteOrigin, '/'),
          description: content.summary
        },
        {
          '@type': 'SoftwareApplication',
          name: 'ashfox',
          url: absoluteUrl(config.siteOrigin, config.workbenchUrl),
          applicationCategory: 'GraphicsApplication',
          operatingSystem: 'Any',
          description: content.summary,
          image: absoluteUrl(config.siteOrigin, '/og.png'),
          isAccessibleForFree: true,
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD'
          },
          license: `${githubUrl}/blob/main/LICENSE`,
          featureList: [
            'Low-poly modeling',
            'Deterministic texturing',
            'Rigging and animation',
            'Reconstructed deterministic build replays',
            'Bedrock, GeckoLib, glTF, and GLB export'
          ]
        }
      ]
    },
    title: 'ashfox'
  });
};
