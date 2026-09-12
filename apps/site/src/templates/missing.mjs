import { pageShell } from './shell.mjs';

export const renderNotFoundPage = ({ assets, config }) =>
  pageShell({
    active: '',
    assets,
    config,
    description: 'The requested ashfox page could not be found.',
    path: '/404.html',
    robots: 'noindex,follow',
    title: 'Page not found',
    body: `
      <main id="main" class="not-found">
        <p class="eyebrow"><span></span>404</p>
        <h1>Page not found.</h1>
        <p>Return to the product or continue through the documentation.</p>
        <div class="hero-actions">
          <a class="button button-primary" href="/">Go home <span>→</span></a>
          <a class="button button-secondary" href="/docs/">Open docs <span>→</span></a>
        </div>
      </main>
    `
  });
