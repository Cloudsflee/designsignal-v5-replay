import { sha256, stableStringify } from './util.mjs';

const noticeUrl = 'https://www.idi.zju.edu.cn/5060.html';
const paper337Url =
  'https://www.idi.zju.edu.cn/wp-content/uploads/2026/06/f952ddc1036c1ac9e9943c67dad6d09b-1.pdf';
const paper902Url =
  'https://www.idi.zju.edu.cn/wp-content/uploads/2026/06/5a10a6eff6ff5a5216ab38c7b6cd3253-2.pdf';

export const SYLLABUS = Object.freeze({
  schemaVersion: 'designsignal.syllabus.v1',
  edition: 'ZJU-IDI-2027',
  effectiveYear: 2027,
  authority: '浙江大学软件学院工业设计工程领域（IDI）',
  evidence: [
    {
      id: 'zju-2027-notice',
      role: 'admission_notice',
      url: noticeUrl,
      published: '2026-06',
      access: 'public_https',
      contentSha256: null,
      hashStatus: 'verify_on_fetch'
    },
    {
      id: 'zju-337-2027',
      role: 'syllabus_337',
      url: paper337Url,
      published: '2026-06',
      access: 'public_https',
      contentSha256: null,
      hashStatus: 'verify_on_fetch'
    },
    {
      id: 'zju-902-2027',
      role: 'syllabus_902',
      url: paper902Url,
      published: '2026-06',
      access: 'public_https',
      contentSha256: null,
      hashStatus: 'verify_on_fetch'
    }
  ],
  subjects: {
    '337': {
      totalPoints: 150,
      sections: [
        {
          id: '337-research',
          titleZh: '设计研究基础',
          points: 75,
          topics: [
            '以用户为中心的设计',
            '设计思维',
            '可持续设计',
            'AI 辅助设计',
            '描述与推断统计',
            '数据可视化',
            '聚类与分类',
            '研究方法应用'
          ]
        },
        {
          id: '337-engineering',
          titleZh: '设计工程基础',
          points: 75,
          topics: [
            '产品开发流程',
            '人机工学',
            '原型与验证',
            '材料与制造',
            '成本与知识产权',
            '深度神经网络',
            '强化学习',
            '生成式 AI',
            'Agent 与工作流',
            '大语言模型'
          ]
        }
      ]
    },
    '902': {
      totalPoints: 150,
      sections: [
        {
          id: '902-critique',
          titleZh: '批判分析与问题重构',
          points: 50,
          topics: ['证据批判', '问题重构', '利益相关者', '边界与假设']
        },
        {
          id: '902-system',
          titleZh: '技术选择与系统链',
          points: 50,
          topics: ['多样用户', '技术选择', '系统链路', '最弱环', '数据与指标', '伦理']
        },
        {
          id: '902-expression',
          titleZh: 'A3 表达或技术方案',
          points: 50,
          topics: ['A3 信息表达', '技术方案', 'fallback', '评估计划', '证据链接']
        }
      ]
    }
  }
});

export const SYLLABUS_SNAPSHOT_SHA256 = sha256(stableStringify(SYLLABUS));

export function syllabusTopic(subject, sectionId, topic) {
  const section = SYLLABUS.subjects[String(subject)]?.sections.find((item) => item.id === sectionId);
  if (!section || !section.topics.includes(topic)) throw new Error('syllabus_mapping_invalid');
  return {
    syllabusEdition: SYLLABUS.edition,
    subject: String(subject),
    sectionId,
    sectionTitleZh: section.titleZh,
    topic,
    evidenceIds: SYLLABUS.evidence.filter((item) => item.role.includes(String(subject))).map((item) => item.id)
  };
}

export function allSyllabusTopics() {
  return Object.values(SYLLABUS.subjects).flatMap((subject) =>
    subject.sections.flatMap((section) => section.topics)
  );
}
