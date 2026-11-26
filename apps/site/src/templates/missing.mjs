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
      <main id="main" class="missing-page">
        <h1>Page not found.</h1>
        <p>Return to the product landing, browse the asset studio, or open the documentation.</p>
        <div class="finale-actions">
          <a class="button button-primary" href="/">Go home →</a>
          <a class="button button-ghost" href="/assets/">Assets studio</a>
          <a class="button button-ghost" href="/docs/">Open docs</a>
        </div>
      </main>
    `,
  });
