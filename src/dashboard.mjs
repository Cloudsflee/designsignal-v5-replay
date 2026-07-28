import { escapeHtml } from './util.mjs';

const categoryLabels = { paper: '论文', product: '产品', ui: '界面', frontier: '前沿' };

export function renderDashboard(report, { outbox = null } = {}) {
  if (!report) return emptyDashboard();
  const sourceHealthy = report.sourceHealth.filter((item) => ['healthy', 'fixture'].includes(item.status)).length;
  const pending = Number(outbox?.pending || 0);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>DesignSignal · ${escapeHtml(report.date)}</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/" aria-label="DesignSignal 首页"><span class="brand-mark" aria-hidden="true">DS</span><span>DesignSignal</span></a>
    <div class="topbar-meta"><time datetime="${escapeHtml(report.date)}">${escapeHtml(report.date)}</time><span class="status-dot ${report.selection.complete ? 'ok' : 'warn'}"></span><span>${report.selection.complete ? '日报完整' : '来源不足'}</span></div>
  </header>
  <main>
    <section class="report-head" aria-labelledby="daily-heading">
      <div>
        <p class="eyebrow">ZJU 337 / 902 · ${escapeHtml(report.syllabus.edition)}</p>
        <h1 id="daily-heading">今日设计信号</h1>
        <p class="head-en">Daily design intelligence with evidence, limits and study action</p>
      </div>
      <dl class="metrics" aria-label="日报状态">
        <div><dt>入选</dt><dd>${report.items.length}<small>/ 6</small></dd></div>
        <div><dt>来源健康</dt><dd>${sourceHealthy}<small>/ ${report.sourceHealth.length}</small></dd></div>
        <div><dt>待投递</dt><dd>${pending}</dd></div>
      </dl>
    </section>

    <section class="signal-workspace" aria-labelledby="signals-heading">
      <aside class="filters" aria-label="信号筛选">
        <div class="filter-group">
          <h2>类型</h2>
          <div class="segmented" data-filter-group="category">
            <button type="button" class="active" data-filter="all" aria-pressed="true">全部</button>
            <button type="button" data-filter="paper" aria-pressed="false">论文</button>
            <button type="button" data-filter="product" aria-pressed="false">产品</button>
            <button type="button" data-filter="ui" aria-pressed="false">界面</button>
            <button type="button" data-filter="frontier" aria-pressed="false">前沿</button>
          </div>
        </div>
        <div class="filter-group">
          <h2>语言</h2>
          <div class="segmented" data-filter-group="language">
            <button type="button" class="active" data-filter="all" aria-pressed="true">全部</button>
            <button type="button" data-filter="zh" aria-pressed="false">中文源</button>
            <button type="button" data-filter="en" aria-pressed="false">英文源</button>
          </div>
        </div>
        <div class="filter-group confidence-control">
          <label for="confidence-filter">最低置信度 <output id="confidence-value">0%</output></label>
          <input id="confidence-filter" type="range" min="0" max="90" value="0" step="5">
        </div>
        <p class="result-count" aria-live="polite"><span id="visible-count">${report.items.length}</span> 条信号</p>
      </aside>

      <div class="signal-column">
        <div class="section-title"><div><p class="eyebrow">Evidence feed</p><h2 id="signals-heading">六条情报</h2></div><span class="selection-hash" title="选择审计哈希">${escapeHtml(report.selection.auditSha256.slice(0, 10))}</span></div>
        <div class="signal-list">
          ${report.items.map((item, index) => signalCard(item, index)).join('')}
        </div>
        <p id="no-results" class="empty-filter" hidden>当前筛选没有匹配信号。</p>
      </div>
    </section>

    <section class="syllabus-band" aria-labelledby="map-heading">
      <div class="section-title"><div><p class="eyebrow">Coverage map</p><h2 id="map-heading">考纲落点</h2></div></div>
      <div class="mapping-grid">${mappingSummary(report)}</div>
    </section>

    <section class="hypothesis-section" aria-labelledby="hypothesis-heading">
      <div class="section-title"><div><p class="eyebrow">Not authoritative</p><h2 id="hypothesis-heading">命题研判</h2></div></div>
      <div class="hypothesis-list">${report.hypotheses.map(hypothesisRow).join('')}</div>
    </section>

    <section class="exercise-section" aria-labelledby="exercise-heading">
      <div class="exercise-head">
        <div><p class="eyebrow">Tomorrow · ${report.coreExercise.timeboxMinutes} min</p><h2 id="exercise-heading">${escapeHtml(report.coreExercise.title.zh)}</h2><p>${escapeHtml(report.coreExercise.title.en)}</p></div>
        <div class="score-total"><strong>100</strong><span>评分</span></div>
      </div>
      <p class="exercise-prompt">${escapeHtml(report.coreExercise.prompt.zh)}</p>
      <div class="exercise-grid">
        <div><h3>交付物</h3><ol>${report.coreExercise.deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol></div>
        <div><h3>评分结构</h3><ul class="rubric">${report.coreExercise.rubric.map((item) => `<li><span>${escapeHtml(item.labelZh)}</span><strong>${item.points}</strong></li>`).join('')}</ul></div>
      </div>
    </section>

    <section class="operations-band" aria-labelledby="source-heading">
      <div class="section-title"><div><p class="eyebrow">Operations</p><h2 id="source-heading">来源状态</h2></div></div>
      <div class="source-table" role="table" aria-label="来源健康">
        ${report.sourceHealth.map(sourceRow).join('')}
      </div>
    </section>

    <section class="feedback-band" aria-labelledby="feedback-heading">
      <div><p class="eyebrow">Calibration</p><h2 id="feedback-heading">次日反馈</h2></div>
      <form id="feedback-form">
        <div class="segmented" data-feedback-choice>
          <button type="button" data-value="useful" aria-pressed="true" class="active">有帮助</button>
          <button type="button" data-value="not_useful" aria-pressed="false">需调整</button>
        </div>
        <label class="sr-only" for="feedback-note">反馈内容</label>
        <textarea id="feedback-note" name="note" maxlength="1000" placeholder="记录命中、偏差或明日调整"></textarea>
        <button class="command-button" type="submit">提交反馈</button>
        <output id="feedback-status" aria-live="polite"></output>
      </form>
    </section>
  </main>
  <footer><span>Integrity ${escapeHtml(report.integrity.contentSha256.slice(0, 12))}</span><a href="/api/reports/latest">JSON</a><a href="/healthz">Health</a></footer>
  <script src="/assets/app.js" defer></script>
</body>
</html>`;
}

function signalCard(item, index) {
  const mappings = item.mappings.map((mapping) => `<span class="mapping-chip"><b>${escapeHtml(mapping.subject)}</b>${escapeHtml(mapping.topic)}</span>`).join('');
  const image = item.image?.url
    ? `<figure><img src="${escapeHtml(item.image.url)}" alt="${escapeHtml(item.image.altZh || item.title.zh)}" width="960" height="600" loading="lazy"><figcaption>${escapeHtml(item.image.license || '')}</figcaption></figure>`
    : '';
  return `<article class="signal-card" data-category="${escapeHtml(item.category)}" data-language="${escapeHtml(item.language)}" data-confidence="${Math.round(item.confidence * 100)}">
    ${image}
    <div class="signal-body">
      <div class="signal-meta"><span class="index">${String(index + 1).padStart(2, '0')}</span><span class="category ${escapeHtml(item.category)}">${escapeHtml(categoryLabels[item.category])}</span><span>${escapeHtml(item.source.institution || item.source.name)}</span><span>${Math.round(item.confidence * 100)}%</span></div>
      <h3>${escapeHtml(item.title.zh)}</h3>
      <p class="title-en">${escapeHtml(item.title.en)}</p>
      <p class="evidence">${escapeHtml(item.evidence.zh)}</p>
      <details><summary>证据与边界</summary><div class="detail-grid"><div><h4>Method</h4><p>${escapeHtml(item.method.zh)}</p></div><div><h4>Limits</h4><p>${escapeHtml(item.limits.zh)}</p></div><div><h4>Why learn</h4><p>${escapeHtml(item.whyLearn.zh)}</p></div><div><h4>Study action</h4><p>${escapeHtml(item.studyAction.zh)}</p></div></div></details>
      <div class="signal-foot"><div class="mapping-chips">${mappings}</div><a href="${escapeHtml(item.citations[0].url)}" target="_blank" rel="noreferrer">${escapeHtml(item.source.name)} ↗</a></div>
    </div>
  </article>`;
}

function mappingSummary(report) {
  const counts = new Map();
  for (const item of report.items)
    for (const mapping of item.mappings) {
      const key = `${mapping.subject}:${mapping.sectionTitleZh}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const [subject, title] = key.split(':');
      return `<div class="mapping-row"><span class="subject-number">${escapeHtml(subject)}</span><div><strong>${escapeHtml(title)}</strong><span>${count} 个证据落点</span></div><meter min="0" max="6" value="${count}">${count}/6</meter></div>`;
    })
    .join('');
}

function hypothesisRow(item) {
  return `<article class="hypothesis-row"><div class="confidence-ring"><strong>${Math.round(item.confidence * 100)}</strong><span>%</span></div><div><h3>${escapeHtml(item.claim.zh)}</h3><p>${escapeHtml(item.claim.en)}</p><div class="hypothesis-evidence"><span>证据 ${item.evidence.length}</span><span>反证 ${item.counterevidence.length}</span><span>${escapeHtml(item.status)}</span></div><p class="counter">${escapeHtml(item.counterevidence[0].detailZh)}</p></div></article>`;
}

function sourceRow(item) {
  const state = ['healthy', 'fixture'].includes(item.status) ? 'ok' : item.status === 'empty' ? 'warn' : 'bad';
  return `<div class="source-row" role="row"><span class="source-state ${state}" aria-label="${escapeHtml(item.status)}"></span><strong role="cell">${escapeHtml(item.sourceName)}</strong><span role="cell">${escapeHtml(item.status)}</span><span role="cell">${item.candidateCount} items</span><span role="cell">${item.latencyMs} ms</span></div>`;
}

function emptyDashboard() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DesignSignal</title><link rel="stylesheet" href="/assets/styles.css"></head><body><header class="topbar"><a class="brand" href="/"><span class="brand-mark">DS</span><span>DesignSignal</span></a></header><main><section class="empty-state"><p class="eyebrow">No report</p><h1>尚无日报</h1><p>等待下一次 23:50 采集任务。</p></section></main></body></html>`;
}
