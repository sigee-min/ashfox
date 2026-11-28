export const initGallery = (root, { onOpenAsset, onResetFilters }) => {
  const section = root.querySelector('[data-studio-gallery]');
  const cards = [...root.querySelectorAll('[data-gallery-card]')];
  const emptyEl = root.querySelector('[data-gallery-empty]');
  const resetBtn = root.querySelector('[data-gallery-reset]');

  for (const card of cards) {
    card.addEventListener('click', () => {
      onOpenAsset(card.dataset.galleryCard);
    });
  }
  resetBtn?.addEventListener('click', onResetFilters);

  const update = (visibleIds, isActiveMode) => {
    if (section) section.hidden = !isActiveMode;
    let count = 0;
    for (const card of cards) {
      const show = visibleIds.has(card.dataset.galleryCard);
      card.hidden = !show;
      if (show) count += 1;
    }
    if (emptyEl) emptyEl.hidden = count > 0;
  };

  return { update };
};
