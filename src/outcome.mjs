import { sha256, stableStringify } from './util.mjs';

const CATEGORIES = Object.freeze(['paper', 'product', 'ui', 'frontier']);

export function deriveReportOutcome({ selection, analyses, sourceHealth, evaluatedAt }) {
  const gaps = [];
  const expected = Object.fromEntries(CATEGORIES.map((category) => [category, Number(selection?.quotas?.[category] || 0)]));
  const actual = Object.fromEntries(CATEGORIES.map((category) => [category, Number(selection?.counts?.[category] || 0)]));
  const quotaReady = CATEGORIES.every((category) => actual[category] === expected[category]);
  if (!quotaReady)
    gaps.push(
      ...CATEGORIES.filter((category) => actual[category] !== expected[category]).map((category) => ({
        code: 'quota_shortage',
        scope: `content.${category}`,
        severity: 'blocking',
        expected: expected[category],
        actual: actual[category]
      }))
    );

  const visualItems = (analyses || []).filter((item) => ['product', 'ui'].includes(item.category));
  const verifiedVisuals = visualItems.filter(hasVerifiedLocalVisual);
  const visualReady = visualItems.length === expected.product + expected.ui && verifiedVisuals.length === visualItems.length;
  if (!visualReady)
    gaps.push({
      code: 'visual_evidence_incomplete',
      scope: 'content.visuals',
      severity: 'blocking',
      expected: expected.product + expected.ui,
      actual: verifiedVisuals.length
    });

  const authoritativeItems = (analyses || []).filter(
    (item) => item.analysis?.model?.authoritative === true && item.analysis?.model?.status === 'completed'
  );
  const modelReady = analyses?.length > 0 && authoritativeItems.length === analyses.length;
  if (!modelReady)
    gaps.push({
      code: 'authoritative_model_incomplete',
      scope: 'model',
      severity: 'blocking',
      expected: analyses?.length || 0,
      actual: authoritativeItems.length
    });

  const requiredSources = (sourceHealth || []).filter((item) => item.required === true);
  const degradedRequired = requiredSources.filter((item) => !['healthy', 'fixture'].includes(item.status));
  const sourcesReady = degradedRequired.length === 0;
  if (!sourcesReady)
    gaps.push({
      code: 'required_source_degraded',
      scope: 'sources',
      severity: 'blocking',
      sourceIds: degradedRequired.map((item) => item.sourceId).sort()
    });

  const checks = {
    quotas: { status: quotaReady ? 'completed' : 'completed_with_gaps', expected, actual },
    visuals: {
      status: visualReady ? 'completed' : 'completed_with_gaps',
      expected: expected.product + expected.ui,
      verified: verifiedVisuals.length,
      itemIds: verifiedVisuals.map((item) => item.id).sort()
    },
    model: {
      status: modelReady ? 'completed' : 'completed_with_gaps',
      expected: analyses?.length || 0,
      authoritative: authoritativeItems.length
    },
    sources: {
      status: sourcesReady ? 'completed' : 'completed_with_gaps',
      required: requiredSources.length,
      healthy: requiredSources.length - degradedRequired.length,
      degradedSourceIds: degradedRequired.map((item) => item.sourceId).sort()
    }
  };
  const status = gaps.length ? 'completed_with_gaps' : 'completed';
  const outcome = {
    schemaVersion: 'designsignal.outcome.v1',
    status,
    evaluatedAt,
    checks,
    gaps,
    fingerprint: null
  };
  outcome.fingerprint = sha256(stableStringify({ ...outcome, fingerprint: null }));
  return outcome;
}

export function hasVerifiedLocalVisual(item) {
  const url = String(item?.image?.url || '');
  const sameOrigin = /^\/assets\/[-\w.]+\.png$/.test(url) || /^\/api\/media\/[a-f0-9]{64}$/.test(url);
  return Boolean(sameOrigin && item?.image?.verified === true && /^[a-f0-9]{64}$/.test(String(item?.image?.sha256 || '')));
}
