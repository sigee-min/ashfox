import { landingShowcase } from './showcase.mjs';
import { landingContent } from '../content.mjs';
import {
  absoluteUrl,
  escapeHtml,
  githubUrl,
  pageShell
} from './shell.mjs';

export const renderLandingPage = ({ assets, config, showcase }) => {
  const content = landingContent;
  const body = `
    <main id="main">
      <section class="showroom-hero" id="quick-start">
        <div class="showroom-intro">
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
                data-default-state="Create with your agent"
                data-copied-state="Copied — paste into your agent"
              >Create with your agent</span>
              <span aria-hidden="true">↗</span>
            </button>
            <a class="button button-secondary" href="#examples">Explore examples <span>↓</span></a>
          </div>
          <p
            class="hero-agent-hint"
            data-copy-feedback
            data-default-feedback="Paste into a browser-capable AI agent and describe your idea."
            aria-live="polite"
          >Paste into a browser-capable AI agent and describe your idea.</p>

        </div>
        ${landingShowcase({ content: content.showcase, showcase })}
      </section>

      <section class="section output-section showroom-output" id="outputs">
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
