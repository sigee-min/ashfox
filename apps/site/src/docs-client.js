const matchesSearchDoc = (doc, query) => {
  if (!query) return true;
  const hay =
    `${doc.title} ${doc.section} ${doc.description} ${(doc.headings || []).join(' ')}`.toLowerCase();
  return hay.includes(query);
};

const renderSearchResults = (results, index, query) => {
  if (!index) return;
  const q = query.trim().toLowerCase();
  const matches = index.filter((doc) => matchesSearchDoc(doc, q)).slice(0, 12);
  results.innerHTML = '';
  for (const item of matches) {
    const a = document.createElement('a');
    a.href = item.route;
    const strong = document.createElement('strong');
    strong.textContent = item.title;
    const span = document.createElement('span');
    span.textContent = `${item.section} · ${item.description}`;
    a.append(strong, span);
    results.append(a);
  }
};

const initDocsSearch = () => {
  const shell = document.querySelector('[data-docs-search-url]');
  const dialog = document.querySelector('[data-docs-search-dialog]');
  const trigger = document.querySelector('[data-docs-search-open]');
  const input = document.querySelector('[data-docs-search-input]');
  const results = document.querySelector('[data-docs-search-results]');
  if (!shell || !dialog || !input || !results) return;

  let index = null;
  const loadIndex = async () => {
    if (index) return index;
    try {
      const resp = await fetch(shell.dataset.docsSearchUrl);
      index = resp.ok ? await resp.json() : [];
    } catch {
      index = [];
    }
    return index;
  };

  const openModal = async () => {
    await loadIndex();
    renderSearchResults(results, index, input.value);
    if (!dialog.open) dialog.showModal();
    input.focus();
  };

  trigger?.addEventListener('click', () => void openModal());
  input.addEventListener('input', () => renderSearchResults(results, index, input.value));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      void openModal();
    }
  });
};

initDocsSearch();
