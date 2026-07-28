(() => {
  const state = { category: 'all', language: 'all', confidence: 0 };
  const cards = [...document.querySelectorAll('.signal-card')];
  const visibleCount = document.querySelector('#visible-count');
  const noResults = document.querySelector('#no-results');

  for (const group of document.querySelectorAll('[data-filter-group]')) {
    group.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-filter]');
      if (!button) return;
      const key = group.dataset.filterGroup;
      state[key] = button.dataset.filter;
      for (const candidate of group.querySelectorAll('button')) {
        const active = candidate === button;
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-pressed', String(active));
      }
      applyFilters();
    });
  }

  const confidence = document.querySelector('#confidence-filter');
  confidence?.addEventListener('input', () => {
    state.confidence = Number(confidence.value);
    document.querySelector('#confidence-value').value = `${state.confidence}%`;
    applyFilters();
  });

  function applyFilters() {
    let count = 0;
    for (const card of cards) {
      const visible =
        (state.category === 'all' || card.dataset.category === state.category) &&
        (state.language === 'all' || card.dataset.language === state.language) &&
        Number(card.dataset.confidence) >= state.confidence;
      card.hidden = !visible;
      if (visible) count += 1;
    }
    if (visibleCount) visibleCount.textContent = String(count);
    if (noResults) noResults.hidden = count !== 0;
  }

  const feedbackChoice = document.querySelector('[data-feedback-choice]');
  let rating = 'useful';
  feedbackChoice?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    rating = button.dataset.value;
    for (const candidate of feedbackChoice.querySelectorAll('button')) {
      const active = candidate === button;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-pressed', String(active));
    }
  });

  document.querySelector('#feedback-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('#feedback-status');
    const note = document.querySelector('#feedback-note');
    const reportDate = document.querySelector('time')?.dateTime;
    status.value = '提交中';
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, note: note.value, reportDate })
      });
      if (!response.ok) throw new Error('feedback_failed');
      note.value = '';
      status.value = '已记录';
    } catch {
      status.value = '提交失败';
    }
  });
})();
