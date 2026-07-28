import { SYLLABUS } from './syllabus.mjs';

const BILINGUAL_FIELDS = ['title', 'summary', 'evidence', 'method', 'novelty', 'limits', 'whyLearn', 'studyAction'];

export function validateAnalysis(item) {
  const errors = [];
  if (!item?.id || !['paper', 'product', 'ui', 'frontier'].includes(item.category)) errors.push('analysis_identity_invalid');
  for (const field of BILINGUAL_FIELDS)
    if (!item?.[field]?.zh?.trim() || !item?.[field]?.en?.trim()) errors.push(`analysis_${field}_bilingual_required`);
  if (!Number.isFinite(item?.confidence) || item.confidence < 0 || item.confidence > 1) errors.push('analysis_confidence_invalid');
  if (!Array.isArray(item?.citations) || !item.citations.length) errors.push('analysis_citations_required');
  for (const citation of item?.citations || []) {
    if (!citation.url || !citation.sourceName || !citation.evidence) errors.push('analysis_citation_invalid');
    if (!citation.fetchedAt || !citation.contentSha256) errors.push('analysis_citation_provenance_required');
  }
  if (!Array.isArray(item?.mappings) || !item.mappings.length) errors.push('analysis_mapping_required');
  for (const mapping of item?.mappings || []) {
    const section = SYLLABUS.subjects[mapping.subject]?.sections.find((entry) => entry.id === mapping.sectionId);
    if (
      mapping.syllabusEdition !== SYLLABUS.edition ||
      !section ||
      !section.topics.includes(mapping.topic) ||
      !mapping.reason?.zh ||
      !mapping.reason?.en
    )
      errors.push('analysis_mapping_invalid');
  }
  return [...new Set(errors)];
}

export function assertAnalysis(item) {
  const errors = validateAnalysis(item);
  if (errors.length) throw schemaError('analysis_schema_invalid', errors);
  return item;
}

export function validateReport(report) {
  const errors = [];
  if (report?.schemaVersion !== 'designsignal.daily.v1') errors.push('report_schema_version_invalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report?.date || '')) errors.push('report_date_invalid');
  if (!Array.isArray(report?.items)) errors.push('report_items_invalid');
  for (const item of report?.items || []) errors.push(...validateAnalysis(item));
  if (report?.selection?.complete && report.items.length !== 6) errors.push('report_complete_quota_invalid');
  if (!Array.isArray(report?.hypotheses) || !report.hypotheses.length) errors.push('report_hypotheses_required');
  for (const hypothesis of report?.hypotheses || []) {
    if (!hypothesis.claim?.zh || !hypothesis.claim?.en) errors.push('hypothesis_bilingual_claim_required');
    if (!hypothesis.evidence?.length || !hypothesis.counterevidence?.length) errors.push('hypothesis_evidence_balance_required');
    if (!Number.isFinite(hypothesis.confidence) || hypothesis.confidence <= 0 || hypothesis.confidence >= 1)
      errors.push('hypothesis_confidence_invalid');
  }
  const exercise = report?.coreExercise;
  if (!exercise?.prompt?.zh || !exercise?.prompt?.en || !exercise?.deliverables?.length || !exercise?.rubric?.length)
    errors.push('core_exercise_incomplete');
  if ((exercise?.rubric || []).reduce((sum, item) => sum + Number(item.points || 0), 0) !== 100)
    errors.push('core_exercise_rubric_points_invalid');
  return [...new Set(errors)];
}

export function assertReport(report) {
  const errors = validateReport(report);
  if (errors.length) throw schemaError('report_schema_invalid', errors);
  return report;
}

function schemaError(code, errors) {
  const error = new Error(code);
  error.code = code;
  error.errors = errors;
  return error;
}
