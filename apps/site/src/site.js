const currentYear = String(new Date().getFullYear());
for (const target of document.querySelectorAll('[data-current-year]')) {
  target.textContent = currentYear;
}

const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('Clipboard unavailable.');
};

const agentInstructionButtons = [
  ...document.querySelectorAll('[data-copy-agent-instruction]')
].filter((button) => button instanceof HTMLButtonElement);
const agentInstructionFeedback = [
  ...document.querySelectorAll('[data-copy-feedback]')
].filter((feedback) => feedback instanceof HTMLElement);
let agentInstructionResetTimer = 0;

const resetAgentInstructionState = () => {
  for (const button of agentInstructionButtons) {
    button.dataset.copied = 'false';
    button.disabled = false;
    const state = button.querySelector('[data-copy-state]');
    if (state instanceof HTMLElement) {
      state.textContent =
        state.dataset.defaultState ?? state.textContent ?? 'Copy';
    }
  }
  for (const feedback of agentInstructionFeedback) {
    delete feedback.dataset.state;
    feedback.textContent = feedback.dataset.defaultFeedback ?? '';
  }
};

const setAgentInstructionState = (status) => {
  for (const button of agentInstructionButtons) {
    button.disabled = status === 'copying';
    button.dataset.copied = String(status === 'success');
    const state = button.querySelector('[data-copy-state]');
    if (!(state instanceof HTMLElement)) continue;
    if (status === 'success') {
      state.textContent = state.dataset.copiedState ?? 'Copied';
    } else if (status === 'copying') {
      state.textContent = 'Copying…';
    } else if (status === 'error') {
      state.textContent = 'Retry';
    }
  }
  for (const feedback of agentInstructionFeedback) {
    feedback.dataset.state = status;
    feedback.textContent = status === 'success'
      ? 'Copied — paste into ChatGPT, Cursor, or Claude.'
      : status === 'copying'
        ? 'Copying…'
        : 'Clipboard unavailable. Try copying again.';
  }
};

for (const button of agentInstructionButtons) {
  button.addEventListener('click', async () => {
    const instruction = button.dataset.instruction?.trim();
    if (!instruction) return;
    window.clearTimeout(agentInstructionResetTimer);
    setAgentInstructionState('copying');
    try {
      await copyText(instruction);
      setAgentInstructionState('success');
    } catch {
      setAgentInstructionState('error');
    } finally {
      for (const instructionButton of agentInstructionButtons) {
        instructionButton.disabled = false;
      }
      agentInstructionResetTimer = window.setTimeout(
        resetAgentInstructionState,
        7_000
      );
    }
  });
}

for (const block of document.querySelectorAll('.doc-article pre')) {
  const code = block.querySelector('code');
  if (!code) continue;
  const button = document.createElement('button');
  button.className = 'copy-code';
  button.type = 'button';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', 'Copy code');
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(code.textContent ?? '');
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = 'Copy';
    }, 1_200);
  });
  block.append(button);
}

const tocLinks = [...document.querySelectorAll('.page-toc a')];
if (tocLinks.length > 0 && 'IntersectionObserver' in window) {
  const linksById = new Map(
    tocLinks.map((link) => [link.getAttribute('href')?.slice(1), link])
  );
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (!visible) return;
      for (const link of tocLinks) link.removeAttribute('aria-current');
      linksById.get(visible.target.id)?.setAttribute('aria-current', 'true');
    },
    { rootMargin: '-15% 0px -70% 0px' }
  );
  for (const id of linksById.keys()) {
    const heading = document.getElementById(id);
    if (heading) observer.observe(heading);
  }
}
