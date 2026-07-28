import { syllabusTopic } from './syllabus.mjs';

export function fixtureSignals(date) {
  const fetchedAt = `${date}T15:50:00.000Z`;
  return [
    signal({
      id: 'fixture-paper-zh-participatory-ai',
      category: 'paper',
      language: 'zh',
      titleZh: '参与式 AI 原型如何暴露服务系统中的权力边界',
      titleEn: 'How Participatory AI Prototypes Expose Power Boundaries in Service Systems',
      source: ['fixture-zju-lab', '浙大设计研究 Fixture', 'https://www.idi.zju.edu.cn/', 'academic', '浙江大学'],
      publishedAt: `${date}T01:10:00.000Z`,
      fetchedAt,
      evidenceZh: '离线样本记录了 18 次共同设计讨论的编码结果；它仅用于验证结构和方法字段，不代表真实论文。',
      evidenceEn:
        'The offline fixture records coded outcomes from 18 co-design discussions; it validates structure and methods and is not presented as a real paper.',
      methodZh: '参与式设计、主题编码与争议点矩阵。',
      methodEn: 'Participatory design, thematic coding, and a controversy matrix.',
      image: null,
      mappings: [
        syllabusTopic('337', '337-research', '以用户为中心的设计'),
        syllabusTopic('902', '902-critique', '利益相关者')
      ]
    }),
    signal({
      id: 'fixture-paper-en-uncertainty',
      category: 'paper',
      language: 'en',
      titleZh: '以不确定性标注改善生成式界面评审',
      titleEn: 'Uncertainty Labels Improve Review of Generative Interfaces',
      source: ['fixture-chi', 'CHI Fixture Proceedings', 'https://dl.acm.org/conference/chi', 'academic', 'International HCI'],
      publishedAt: `${date}T02:20:00.000Z`,
      fetchedAt,
      evidenceZh: '离线样本比较带与不带置信标注的两组评审任务，并保留效应方向和局限字段。',
      evidenceEn:
        'The fixture compares review tasks with and without confidence labels while preserving effect direction and limitations.',
      methodZh: '组间实验、任务正确率与校准误差比较。',
      methodEn: 'Between-group experiment comparing task accuracy and calibration error.',
      image: null,
      mappings: [
        syllabusTopic('337', '337-research', '描述与推断统计'),
        syllabusTopic('902', '902-system', '数据与指标')
      ]
    }),
    signal({
      id: 'fixture-product-repairable-speaker',
      category: 'product',
      language: 'en',
      titleZh: '可维修模块化桌面扬声器',
      titleEn: 'Repairable Modular Desktop Speaker',
      source: ['fixture-core77', 'Core77 Product Fixture', 'https://www.core77.com/', 'product_media', 'Core77'],
      publishedAt: `${date}T03:30:00.000Z`,
      fetchedAt,
      evidenceZh: '离线产品样本展示可拆外壳、标准紧固件和部件成本表，用于验证图像与产品分析路径。',
      evidenceEn:
        'The offline product fixture shows a removable shell, standard fasteners, and a component cost table to validate image and product-analysis paths.',
      methodZh: '拆解路径、材料选择、成本与维修时间对比。',
      methodEn: 'Teardown path, material choice, cost, and repair-time comparison.',
      image: '/assets/product-signal.png',
      mappings: [
        syllabusTopic('337', '337-engineering', '材料与制造'),
        syllabusTopic('337', '337-engineering', '成本与知识产权')
      ]
    }),
    signal({
      id: 'fixture-ui-civic-service',
      category: 'ui',
      language: 'zh',
      titleZh: '低带宽政务服务状态界面',
      titleEn: 'Low-Bandwidth Civic Service Status Interface',
      source: ['fixture-awwwards', 'Awwwards UI Fixture', 'https://www.awwwards.com/', 'ui_media', 'Awwwards'],
      publishedAt: `${date}T04:40:00.000Z`,
      fetchedAt,
      evidenceZh: '离线界面样本保留离线状态、文字 fallback、步骤错误恢复和键盘导航设计。',
      evidenceEn:
        'The offline interface fixture preserves offline states, text fallbacks, step recovery, and keyboard navigation.',
      methodZh: '关键任务走查、弱网模拟与可访问性检查。',
      methodEn: 'Critical-task walkthrough, constrained-network simulation, and accessibility review.',
      image: '/assets/ui-signal.png',
      mappings: [
        syllabusTopic('337', '337-engineering', '人机工学'),
        syllabusTopic('902', '902-system', '多样用户'),
        syllabusTopic('902', '902-expression', 'fallback')
      ]
    }),
    signal({
      id: 'fixture-frontier-agent-evaluation',
      category: 'frontier',
      language: 'en',
      titleZh: 'Agent 工作流评估从单点准确率转向链路可靠性',
      titleEn: 'Agent Evaluation Moves from Point Accuracy to Chain Reliability',
      source: ['fixture-openai', 'OpenAI Research Fixture', 'https://openai.com/research/', 'frontier_lab', 'OpenAI'],
      publishedAt: `${date}T05:50:00.000Z`,
      fetchedAt,
      evidenceZh: '离线前沿样本把工具错误、恢复次数和最终任务完成率分开记录，避免把演示当作稳定能力。',
      evidenceEn:
        'The frontier fixture separates tool errors, recovery count, and final completion rate so a demo is not mistaken for stable capability.',
      methodZh: '多步轨迹回放、错误分类与恢复成本分析。',
      methodEn: 'Multi-step trace replay, error taxonomy, and recovery-cost analysis.',
      image: null,
      mappings: [
        syllabusTopic('337', '337-engineering', 'Agent 与工作流'),
        syllabusTopic('902', '902-system', '最弱环')
      ]
    }),
    signal({
      id: 'fixture-frontier-zh-material-model',
      category: 'frontier',
      language: 'zh',
      titleZh: '材料约束进入生成式产品概念模型',
      titleEn: 'Material Constraints Enter Generative Product Concept Models',
      source: ['fixture-msr', 'Microsoft Research Fixture', 'https://www.microsoft.com/en-us/research/', 'frontier_lab', 'Microsoft Research'],
      publishedAt: `${date}T07:00:00.000Z`,
      fetchedAt,
      evidenceZh: '离线前沿样本把材料强度、制造半径和碳预算作为生成约束，并记录不可行解的拒绝原因。',
      evidenceEn:
        'The fixture treats material strength, manufacturing radius, and carbon budget as generation constraints and records why infeasible concepts are rejected.',
      methodZh: '约束生成、可行性筛选与负样本审计。',
      methodEn: 'Constraint-guided generation, feasibility screening, and negative-sample auditing.',
      image: null,
      mappings: [
        syllabusTopic('337', '337-research', '可持续设计'),
        syllabusTopic('337', '337-engineering', '生成式 AI')
      ]
    })
  ];
}

function signal({
  id,
  category,
  language,
  titleZh,
  titleEn,
  source,
  publishedAt,
  fetchedAt,
  evidenceZh,
  evidenceEn,
  methodZh,
  methodEn,
  image,
  mappings
}) {
  return {
    id,
    canonicalId: id,
    category,
    language,
    title: { zh: titleZh, en: titleEn },
    abstract: { zh: evidenceZh, en: evidenceEn },
    evidenceExcerpt: { zh: evidenceZh, en: evidenceEn },
    methodHint: { zh: methodZh, en: methodEn },
    source: {
      id: source[0],
      name: source[1],
      url: source[2],
      kind: source[3],
      institution: source[4],
      authority: 'fixture_only'
    },
    url: `${source[2]}#${id}`,
    publishedAt,
    fetchedAt,
    authors: ['DesignSignal offline fixture'],
    image: image ? { url: image, altZh: titleZh, altEn: titleEn, license: 'generated-fixture' } : null,
    access: { status: 'public', openAccess: true, paywalled: false, loginRequired: false },
    license: { status: 'fixture-generated', name: 'Project fixture', url: null },
    content: { mimeType: 'application/json', bytes: 0, sha256: null, cached: false },
    mappings,
    isFixture: true
  };
}
