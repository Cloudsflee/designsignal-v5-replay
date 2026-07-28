import { assertReport } from './schema.mjs';
import { SYLLABUS, SYLLABUS_SNAPSHOT_SHA256 } from './syllabus.mjs';
import { deterministicId, escapeHtml, sha256, stableStringify } from './util.mjs';

export function buildDailyReport({ date, collection, selection, analyses, generatedAt = new Date().toISOString() }) {
  const report = {
    schemaVersion: 'designsignal.daily.v1',
    id: deterministicId('daily', date, selection.auditSha256),
    date,
    timeZone: 'Asia/Shanghai',
    generatedAt,
    mode: collection.mode,
    title: { zh: `${date} 设计信号`, en: `Design Signals · ${date}` },
    syllabus: {
      edition: SYLLABUS.edition,
      snapshotSha256: SYLLABUS_SNAPSHOT_SHA256,
      evidence: SYLLABUS.evidence
    },
    selection: {
      id: selection.id,
      algorithm: selection.algorithm,
      quotas: selection.quotas,
      counts: selection.counts,
      complete: selection.complete,
      shortages: selection.shortages,
      auditSha256: selection.auditSha256,
      rejectedCount: selection.rejected.length
    },
    items: analyses,
    hypotheses: buildHypotheses(analyses, collection.sourceHealth),
    coreExercise: buildCoreExercise(analyses, date),
    sourceHealth: collection.sourceHealth,
    rejectionAudit: selection.rejected,
    integrity: { contentSha256: null }
  };
  report.integrity.contentSha256 = sha256(stableStringify({ ...report, integrity: { contentSha256: null } }));
  return assertReport(report);
}

function buildHypotheses(items, sourceHealth) {
  const frontier = items.filter((item) => item.category === 'frontier');
  const productOrUi = items.filter((item) => ['product', 'ui'].includes(item.category));
  const paper = items.filter((item) => item.category === 'paper');
  const degraded = sourceHealth.filter((item) => item.status === 'degraded');
  const hypotheses = [];
  if (frontier.length) {
    hypotheses.push({
      id: 'hyp-system-reliability',
      claim: {
        zh: '近期公开信号可能更重视 AI 系统链的可靠性、恢复与最弱环，而非单点模型能力。',
        en: 'Recent public signals may place more weight on AI system-chain reliability, recovery, and weakest links than on point model capability.'
      },
      evidence: frontier.map(evidenceRef),
      counterevidence: [
        {
          type: 'coverage_limit',
          detailZh: `本轮仅有 ${frontier.length} 条前沿信号，不能推出考试命题趋势。`,
          detailEn: `This run contains only ${frontier.length} frontier signals and cannot establish an exam-setting trend.`
        }
      ],
      confidence: Math.min(0.72, 0.48 + frontier.length * 0.08),
      status: 'working_hypothesis'
    });
  }
  if (productOrUi.length) {
    hypotheses.push({
      id: 'hyp-fallback-evidence',
      claim: {
        zh: '方案表达中把 fallback、约束和指标放在同一系统链，可能比只展示理想流程更有区分度。',
        en: 'Putting fallbacks, constraints, and metrics in the same system chain may be more discriminating than showing an ideal flow alone.'
      },
      evidence: productOrUi.map(evidenceRef),
      counterevidence: [
        {
          type: 'transfer_limit',
          detailZh: '产品与界面媒体案例不等同于 902 评分标准，仍需以大纲和历年要求校准。',
          detailEn: 'Product and interface media cases are not equivalent to 902 scoring criteria and still require syllabus calibration.'
        }
      ],
      confidence: 0.59,
      status: 'working_hypothesis'
    });
  }
  if (paper.length) {
    hypotheses.push({
      id: 'hyp-method-boundary',
      claim: {
        zh: '337 研究题中明确方法、样本边界和反证，可能比罗列研究名词更能体现分析质量。',
        en: 'In 337 research questions, explicit methods, sample boundaries, and counterevidence may demonstrate more analytical quality than listing research terms.'
      },
      evidence: paper.map(evidenceRef),
      counterevidence: [
        {
          type: 'source_limit',
          detailZh: degraded.length
            ? `${degraded.length} 个来源降级，当前样本的机构与语言覆盖不完整。`
            : '单日论文样本很小，方法偏好不能直接外推到正式考试。',
          detailEn: degraded.length
            ? `${degraded.length} sources are degraded, leaving incomplete institutional and language coverage.`
            : 'A single-day paper sample is small and method preferences cannot be directly extrapolated to the formal exam.'
        }
      ],
      confidence: 0.57,
      status: 'working_hypothesis'
    });
  }
  return hypotheses;
}

function evidenceRef(item) {
  return {
    itemId: item.id,
    sourceName: item.source.name,
    citationUrl: item.citations[0].url,
    claimZh: item.evidence.zh,
    claimEn: item.evidence.en,
    contentSha256: item.citations[0].contentSha256
  };
}

function buildCoreExercise(items, date) {
  const evidenceLinks = items.slice(0, 4).map((item) => ({ itemId: item.id, title: item.title, url: item.citations[0].url }));
  return {
    id: deterministicId('exercise', date, ...items.map((item) => item.id)),
    title: { zh: '从信号到 902 系统链：弱网公共服务', en: 'From Signals to a 902 System Chain: Low-Bandwidth Public Service' },
    objective: {
      zh: '把公开信号转成一页可批判、可落地、可评估的技术方案。',
      en: 'Turn public signals into a one-page technical proposal that is critical, actionable, and measurable.'
    },
    timeboxMinutes: 150,
    phases: [
      { minutes: 20, zh: '证据摘录与问题重构', en: 'Evidence extraction and problem reframing' },
      { minutes: 35, zh: '用户、约束与系统链', en: 'Users, constraints, and system chain' },
      { minutes: 45, zh: '主方案、fallback 与最弱环', en: 'Primary path, fallback, and weakest link' },
      { minutes: 30, zh: '指标、数据与伦理', en: 'Metrics, data, and ethics' },
      { minutes: 20, zh: 'A3 复核与删减', en: 'A3 review and reduction' }
    ],
    prompt: {
      zh: '为网络不稳定、设备性能差异大且包含视障用户的公共办事场景设计 AI 辅助服务。必须引用今日至少三条信号，重构问题，给出端到端系统链、离线 fallback、最弱环、数据/指标和伦理边界。',
      en: 'Design an AI-assisted public service for unstable networks, varied device capability, and users with visual impairments. Cite at least three signals from today, reframe the problem, and provide an end-to-end chain, offline fallback, weakest link, data/metrics, and ethical boundaries.'
    },
    deliverables: [
      'A3 单页信息结构 / A3 one-page information structure',
      '问题重构与三条证据 / Reframed problem with three evidence references',
      '主链路、fallback 与失败恢复 / Primary chain, fallback, and recovery',
      '三个指标及数据获取方法 / Three metrics and data acquisition methods',
      '伦理风险与停止条件 / Ethical risks and stop conditions'
    ],
    rubric: [
      { key: 'evidence', labelZh: '证据质量与引用', labelEn: 'Evidence and citations', points: 20 },
      { key: 'reframe', labelZh: '批判与问题重构', labelEn: 'Critique and reframing', points: 20 },
      { key: 'system', labelZh: '系统链与技术选择', labelEn: 'System chain and technical choices', points: 25 },
      { key: 'fallback', labelZh: 'fallback 与最弱环', labelEn: 'Fallback and weakest link', points: 15 },
      { key: 'metrics', labelZh: '指标、数据与伦理', labelEn: 'Metrics, data, and ethics', points: 20 }
    ],
    answerFramework: [
      'Context -> stakeholders -> evidence-backed tension',
      'Reframed question -> decision principles',
      'Input -> model/tool -> validation -> human decision -> feedback',
      'Failure trigger -> fallback -> recovery owner',
      'Metric -> data source -> threshold -> stop condition'
    ],
    evidenceLinks
  };
}

export function renderReportMarkdown(report) {
  const lines = [
    `# ${report.title.zh}`,
    '',
    `> ${report.title.en}`,
    '',
    `- 日期 / Date: ${report.date}`,
    `- 时区 / Time zone: ${report.timeZone}`,
    `- 模式 / Mode: ${report.mode}`,
    `- 选择 / Selection: ${report.items.length}/6 (${report.selection.complete ? 'complete' : 'incomplete'})`,
    `- 考纲 / Syllabus: ${report.syllabus.edition}`,
    '',
    '## 今日六条 / Today\'s Signals',
    ''
  ];
  for (const [index, item] of report.items.entries()) {
    lines.push(
      `### ${index + 1}. ${item.title.zh}`,
      '',
      `**${item.title.en}**`,
      '',
      `- 类型 / Category: ${item.category}`,
      `- 来源 / Source: [${item.source.name}](${item.citations[0].url})`,
      `- 置信度 / Confidence: ${item.confidence.toFixed(2)}`,
      '',
      `**证据 / Evidence**`,
      '',
      item.evidence.zh,
      '',
      item.evidence.en,
      '',
      `**方法 / Method**: ${item.method.zh} / ${item.method.en}`,
      '',
      `**新意 / Novelty**: ${item.novelty.zh} / ${item.novelty.en}`,
      '',
      `**局限 / Limits**: ${item.limits.zh} / ${item.limits.en}`,
      '',
      `**为什么学 / Why learn**: ${item.whyLearn.zh} / ${item.whyLearn.en}`,
      '',
      `**学习动作 / Study action**: ${item.studyAction.zh} / ${item.studyAction.en}`,
      '',
      `**映射 / Mappings**: ${item.mappings.map((mapping) => `${mapping.subject} · ${mapping.topic}`).join('; ')}`,
      ''
    );
  }
  lines.push('## 命题研判 / Working Hypotheses', '');
  for (const hypothesis of report.hypotheses)
    lines.push(
      `### ${hypothesis.claim.zh}`,
      '',
      hypothesis.claim.en,
      '',
      `- 置信度 / Confidence: ${hypothesis.confidence.toFixed(2)}`,
      `- 证据 / Evidence: ${hypothesis.evidence.map((item) => item.itemId).join(', ')}`,
      `- 反证 / Counterevidence: ${hypothesis.counterevidence.map((item) => item.detailZh).join('；')}`,
      ''
    );
  lines.push(
    '## 明日核心练习 / Core Exercise',
    '',
    `### ${report.coreExercise.title.zh}`,
    '',
    report.coreExercise.title.en,
    '',
    `- Timebox: ${report.coreExercise.timeboxMinutes} min`,
    '',
    report.coreExercise.prompt.zh,
    '',
    report.coreExercise.prompt.en,
    '',
    '### Deliverables',
    '',
    ...report.coreExercise.deliverables.map((item) => `- ${item}`),
    '',
    '### Rubric',
    '',
    ...report.coreExercise.rubric.map((item) => `- ${item.labelZh} / ${item.labelEn}: ${item.points}`),
    '',
    `---`,
    `Integrity SHA-256: ${report.integrity.contentSha256}`,
    ''
  );
  return lines.join('\n');
}

export function renderPortableHtml(report) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.title.zh)}</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:960px;margin:auto;padding:32px;color:#16201c}h1,h2,h3{line-height:1.25}article{border-top:1px solid #ccd5cf;padding:20px 0}.meta{color:#52605a}a{color:#006b4f}</style></head><body><h1>${escapeHtml(report.title.zh)}</h1><p class="meta">${escapeHtml(report.title.en)} · ${escapeHtml(report.syllabus.edition)}</p>${report.items.map((item) => `<article><h2>${escapeHtml(item.title.zh)}</h2><h3>${escapeHtml(item.title.en)}</h3><p>${escapeHtml(item.evidence.zh)}</p><p>${escapeHtml(item.evidence.en)}</p><p class="meta">${escapeHtml(item.source.name)} · ${item.confidence.toFixed(2)}</p></article>`).join('')}<h2>${escapeHtml(report.coreExercise.title.zh)}</h2><p>${escapeHtml(report.coreExercise.prompt.zh)}</p></body></html>`;
}
