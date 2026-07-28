import fs from 'node:fs/promises';
import { requestBytes } from './security.mjs';
import { assertAnalysis } from './schema.mjs';
import { syllabusTopic } from './syllabus.mjs';
import { clamp, cleanText, deterministicId, publicError } from './util.mjs';

const MAPPING_RULES = [
  ['用户|user|participatory|accessib', '337', '337-research', '以用户为中心的设计'],
  ['统计|experiment|calibration|metric', '337', '337-research', '描述与推断统计'],
  ['可持续|carbon|repair|material', '337', '337-research', '可持续设计'],
  ['材料|manufactur|prototype|repair', '337', '337-engineering', '材料与制造'],
  ['agent|workflow|工具|链路', '337', '337-engineering', 'Agent 与工作流'],
  ['generative|生成式|language model', '337', '337-engineering', '生成式 AI'],
  ['stakeholder|利益相关者|power|批判', '902', '902-critique', '利益相关者'],
  ['fallback|offline|弱网|recovery', '902', '902-expression', 'fallback'],
  ['metric|指标|confidence|置信', '902', '902-system', '数据与指标'],
  ['weakest|最弱环|reliability|可靠', '902', '902-system', '最弱环']
];

export async function resolveModelConfig(config, environment = process.env) {
  if ((!config.model || !config.apiKey) && config.codexConfigPath) {
    const text = await fs.readFile(config.codexConfigPath, 'utf8');
    const model = config.model || tomlValue(text, 'model');
    const providerName = tomlValue(text, 'model_provider');
    const provider = providerName ? tomlSection(text, `model_providers.${providerName}`) : {};
    const envKey = provider.env_key || provider.envKey || 'OPENAI_API_KEY';
    return {
      ...config,
      model: model || null,
      baseUrl: provider.base_url || provider.baseUrl || config.baseUrl,
      apiKey: config.apiKey || environment[envKey] || null
    };
  }
  return config;
}

export async function analyzeSignals(items, config, options = {}) {
  const resolved = await resolveModelConfig(config, options.environment);
  const analyses = [];
  for (const item of items) analyses.push(await analyzeSignal(item, resolved, options));
  return analyses;
}

export async function analyzeSignal(item, config, { transport = requestBytes, now = () => new Date() } = {}) {
  if (config.model && config.apiKey) {
    let error;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const modeled = await modelAnalysis(item, config, transport, now);
        return assertAnalysis(modeled);
      } catch (caught) {
        error = caught;
      }
    }
    const fallback = deterministicAnalysis(item, now);
    fallback.analysis.model = {
      provider: 'openai-compatible-responses',
      model: config.model,
      status: 'failed_fallback',
      error: publicError(error, [config.apiKey]),
      generatedAt: now().toISOString(),
      authoritative: false
    };
    return assertAnalysis(fallback);
  }
  return assertAnalysis(deterministicAnalysis(item, now));
}

export function deterministicAnalysis(item, now = () => new Date()) {
  const category = item.category;
  const title = completeBilingual(item.title, '标题', 'title');
  const summary = completeBilingual(item.abstract, '摘要', 'summary');
  const evidence = completeBilingual(item.evidenceExcerpt, '证据', 'evidence');
  const method = completeBilingual(item.methodHint, '来源未提供明确方法；仅保留可核验描述。', 'The source does not state a clear method; only verifiable description is retained.');
  const categoryCopy = categoryText(category);
  const mappings = enrichMappings(item.mappings?.length ? item.mappings : inferMappings(item));
  return {
    id: item.id,
    canonicalId: item.canonicalId,
    url: item.url,
    analysisId: deterministicId('ana', item.id, item.provenance.responseSha256),
    category,
    language: item.language,
    title,
    summary,
    evidence,
    method,
    novelty: {
      zh: `相较常规${categoryCopy.zh}摘要，该信号把可核验证据、方法与应用边界放在同一记录中。`,
      en: `Compared with a conventional ${categoryCopy.en} digest, this signal keeps verifiable evidence, method, and application boundaries in one record.`
    },
    limits: {
      zh: item.isFixture
        ? '这是离线结构化样本，不得作为真实研究或市场事实引用；结论需回到真实来源复核。'
        : '当前分析只使用公开页面与元数据；样本、因果性和长期效果仍需回到全文或实测验证。',
      en: item.isFixture
        ? 'This is an offline structural fixture and must not be cited as a real research or market fact; conclusions require verification against real sources.'
        : 'This analysis uses public pages and metadata only; samples, causality, and long-term effects require full-text or empirical verification.'
    },
    whyLearn: {
      zh: `它可训练把${mappings.map((entry) => entry.topic).slice(0, 2).join('、')}从名词复述转成证据、约束与方案判断。`,
      en: `It helps turn ${mappings.map((entry) => entry.topic).slice(0, 2).join(' and ')} from term recall into evidence, constraints, and design judgment.`
    },
    mappings,
    studyAction: {
      zh: '用 12 分钟写出一条证据、一条反证和一个可测指标，再把它放入 337 知识点或 902 系统链。',
      en: 'In 12 minutes, write one supporting fact, one counterpoint, and one measurable indicator, then place them in a 337 topic or a 902 system chain.'
    },
    citations: [
      {
        sourceName: item.source.name,
        url: item.url,
        evidence: item.evidenceExcerpt[item.language] || item.evidenceExcerpt.en || item.evidenceExcerpt.zh,
        fetchedAt: item.provenance.fetchedAt,
        contentSha256: item.provenance.responseSha256,
        accessStatus: item.access.status,
        licenseStatus: item.license.status
      }
    ],
    confidence: confidenceFor(item),
    image: item.image,
    source: item.source,
    access: item.access,
    license: item.license,
    publishedAt: item.publishedAt,
    provenance: item.provenance,
    analysis: {
      model: {
        provider: 'deterministic-local',
        model: null,
        status: 'not_configured',
        generatedAt: now().toISOString(),
        authoritative: false
      }
    }
  };
}

async function modelAnalysis(item, config, transport, now) {
  const endpoint = new URL('responses', `${config.baseUrl.replace(/\/$/, '')}/`).href;
  const host = new URL(endpoint).hostname;
  const prompt = [
    'Return only JSON. Analyze the supplied public-source design signal for a ZJU 337/902 learner.',
    'Every text field must contain both zh and en. Do not invent evidence, sample sizes, outcomes, or citations.',
    'Required keys: title, summary, evidence, method, novelty, limits, whyLearn, studyAction, mappings, confidence.',
    'Each bilingual field is {"zh":"...","en":"..."}. mappings uses the supplied syllabus mappings and adds only bilingual reason.',
    JSON.stringify({
      title: item.title,
      abstract: item.abstract,
      evidenceExcerpt: item.evidenceExcerpt,
      methodHint: item.methodHint,
      category: item.category,
      source: item.source,
      mappings: item.mappings
    })
  ].join('\n');
  const body = JSON.stringify({
    model: config.model,
    input: prompt,
    temperature: 0.1,
    max_output_tokens: 2500
  });
  const response = await transport(endpoint, {
    allowedHosts: [...new Set([...config.allowedHosts, host])],
    timeoutMs: config.timeoutMs,
    maxBytes: config.maxBytes,
    retries: config.retries,
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    body
  });
  if (response.status < 200 || response.status >= 300) throw modelError('model_http_error');
  const envelope = JSON.parse(response.bytes.toString('utf8'));
  const outputText = envelope.output_text ||
    envelope.output?.flatMap((entry) => entry.content || []).find((entry) => entry.type === 'output_text')?.text;
  if (!outputText) throw modelError('model_output_missing');
  const parsed = JSON.parse(stripJsonFence(outputText));
  const fallback = deterministicAnalysis(item, now);
  const result = {
    ...fallback,
    ...Object.fromEntries(
      ['title', 'summary', 'evidence', 'method', 'novelty', 'limits', 'whyLearn', 'studyAction'].map((key) => [
        key,
        completeBilingual(parsed[key], fallback[key].zh, fallback[key].en)
      ])
    ),
    mappings: enrichMappings(
      fallback.mappings.map((mapping, index) => ({ ...mapping, reason: completeBilingual(parsed.mappings?.[index]?.reason, mapping.reason.zh, mapping.reason.en) }))
    ),
    confidence: clamp(parsed.confidence, 0.05, 0.95),
    analysis: {
      model: {
        provider: 'openai-compatible-responses',
        model: config.model,
        status: 'completed',
        responseId: cleanText(envelope.id, 300) || null,
        generatedAt: now().toISOString(),
        authoritative: false
      }
    }
  };
  return result;
}

function inferMappings(item) {
  const text = `${item.title?.zh || ''} ${item.title?.en || ''} ${item.abstract?.zh || ''} ${item.abstract?.en || ''}`.toLowerCase();
  const found = [];
  for (const [pattern, subject, section, topic] of MAPPING_RULES) {
    if (new RegExp(pattern, 'i').test(text)) found.push(syllabusTopic(subject, section, topic));
    if (found.length === 3) break;
  }
  if (!found.length) found.push(syllabusTopic('902', '902-critique', '证据批判'));
  return found;
}

function enrichMappings(mappings) {
  return mappings.map((mapping) => ({
    ...mapping,
    confidence: 0.68,
    reason: mapping.reason || {
      zh: `该信号的证据或方法可直接用于练习“${mapping.topic}”中的判断与表达。`,
      en: `The signal's evidence or method directly supports judgment and articulation practice for “${mapping.topic}”.`
    }
  }));
}

function confidenceFor(item) {
  let value = item.isFixture ? 0.68 : 0.58;
  if (item.provenance?.responseSha256) value += 0.08;
  if (item.methodHint?.zh || item.methodHint?.en) value += 0.05;
  if (item.source?.authority === 'publisher_page' || item.source?.authority === 'publisher_feed') value += 0.08;
  return clamp(value, 0.05, 0.95);
}

function completeBilingual(value, fallbackZh, fallbackEn) {
  const source = value && typeof value === 'object' ? value : {};
  const zh = cleanText(source.zh, 10_000);
  const en = cleanText(source.en, 10_000);
  return {
    zh: zh || cleanText(fallbackZh, 10_000) || (en ? `原文证据（英文）：${en}` : '公开来源未提供中文内容。'),
    en: en || cleanText(fallbackEn, 10_000) || (zh ? `Original evidence (Chinese): ${zh}` : 'The public source did not provide English content.')
  };
}

function categoryText(category) {
  return {
    paper: { zh: '论文', en: 'paper' },
    product: { zh: '产品案例', en: 'product case' },
    ui: { zh: '界面案例', en: 'interface case' },
    frontier: { zh: '前沿动态', en: 'frontier update' }
  }[category];
}

function stripJsonFence(value) {
  return String(value).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function tomlValue(text, key) {
  return cleanText(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm').exec(text)?.[1], 1000) || null;
}

function tomlSection(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`^\\s*\\[${escaped}\\]\\s*$([\\s\\S]*?)(?=^\\s*\\[|\\s*$)`, 'm').exec(text)?.[1] || '';
  return Object.fromEntries(
    [...block.matchAll(/^\s*([\w-]+)\s*=\s*["']([^"']*)["']/gm)].map((match) => [match[1], match[2]])
  );
}

function modelError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
