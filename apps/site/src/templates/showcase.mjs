import { escapeHtml } from './shell.mjs';

export const landingShowcase = ({ content, showcase }) => {
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
  const count = String(entries.length).padStart(2, '0');
  const data = JSON.stringify(entries).replaceAll('<', '\\u003c');
  return `
    <section class="showroom" id="examples" data-showroom aria-label="Character showcase">
      <script type="application/json" data-showroom-data>${data}</script>
      <div class="showroom-heading"><span class="eyebrow">${escapeHtml(content.eyebrow)}</span><span>${first.index} — ${count} / The collection</span></div>
      <div class="character-choices" role="group" aria-label="Choose a character">
        ${entries.map((entry, index) => `<button type="button" data-character="${index}" aria-pressed="${index === 0}" aria-label="Select ${escapeHtml(entry.label)}"><span>${entry.index}</span><img src="${escapeHtml(entry.posterSrc)}" width="160" height="90" loading="lazy" alt=""><strong>${escapeHtml(entry.label)}</strong><span aria-hidden="true">↗</span></button>`).join('')}
      </div>
      <div class="character-stage">
        <span class="stage-word" aria-hidden="true" data-stage-word>${first.entryName}</span>
        <img data-character-poster src="${escapeHtml(first.posterSrc)}" width="640" height="360" alt="${escapeHtml(first.label)}" fetchpriority="high">
        <video data-character-player muted playsinline loop preload="none" aria-label="${escapeHtml(first.label)} animated preview" hidden></video>
        <div class="stage-label"><span>LOW POLY / FULL OF LIFE</span><span data-character-position>${first.index} / ${count}</span></div>
      </div>
      <p class="motion-status" data-motion-status role="status" hidden></p>
      <div class="character-controls">
        <div class="character-description" aria-live="polite"><h2 data-character-name>${escapeHtml(first.label)}</h2><p data-character-summary>${escapeHtml(first.summary)}</p></div>
        <div class="motion-controls"><div data-motion-list role="group" aria-label="Choose a motion"></div><button type="button" class="motion-toggle" data-motion-toggle aria-pressed="false">Play motion</button></div>
      </div>
      <div class="character-delivery"><p>Make it yours.</p><a data-workspace-download href="${first.workspaceHref}" download>Download workspace <span>↓</span></a><a data-glb-download href="${first.glbHref}" download>Download GLB <span>↓</span></a><a href="${showcase.workbenchHref}">Open Workbench <span>↗</span></a></div>
      <button class="creation-card" type="button" data-build-open aria-haspopup="dialog" aria-controls="build-viewer">
        <span class="creation-thumbnail"><img data-build-thumbnail src="${escapeHtml(first.posterSrc)}" width="160" height="90" loading="lazy" alt=""><span aria-hidden="true">▶</span></span>
        <span class="creation-copy"><span class="eyebrow">Behind the character</span><strong>Watch it take shape.</strong><span>From the first shapes to the final details.</span></span>
        <span class="creation-arrow" aria-hidden="true">↗</span>
      </button>
      <dialog class="build-viewer" id="build-viewer" aria-labelledby="build-title" aria-describedby="build-description" data-build-dialog>
        <header><div><p class="eyebrow">Behind the character</p><h2 id="build-title" data-build-title>${escapeHtml(first.label)}</h2></div><button type="button" data-build-close aria-label="Close build preview">✕</button></header>
        <video data-build-player controls muted playsinline preload="none" aria-label="Character construction preview"></video>
        <p data-build-status role="status" hidden></p>
        <footer><p id="build-description">${escapeHtml(content.provenance)}<br>This is a visual breakdown, not a recording of the AI session.</p><a href="/docs/guides/ai-agent-quick-start/">Create your own <span aria-hidden="true">↗</span></a></footer>
      </dialog>
    </section>
  `;
};
