import { DEFAULT_QUOTAS } from './config.mjs';
import { cleanText, deterministicId, sha256, stableStringify } from './util.mjs';

const CATEGORIES = Object.freeze(['paper', 'product', 'ui', 'frontier']);

export function selectDailySignals(collection, { date, history = [], quotas = DEFAULT_QUOTAS } = {}) {
  const candidates = Array.isArray(collection?.candidates) ? collection.candidates : [];
  const historyKeys = recentHistoryKeys(history, date, 60);
  const acceptedCandidates = [];
  const rejected = [...(collection?.rejected || [])];
  const seenThisRun = new Set();
  for (const candidate of candidates) {
    const problem = candidateProblem(candidate);
    const key = candidateKey(candidate);
    if (problem) rejected.push(rejection(candidate, problem));
    else if (historyKeys.has(key)) rejected.push(rejection(candidate, 'duplicate_60_day_history'));
    else if (seenThisRun.has(key)) rejected.push(rejection(candidate, 'duplicate_current_collection'));
    else {
      seenThisRun.add(key);
      acceptedCandidates.push({ candidate, key, score: scoreCandidate(candidate, date) });
    }
  }

  const selected = [];
  const selectedSourceIds = new Set();
  for (const category of CATEGORIES) {
    const quota = Number(quotas[category] || 0);
    const pool = acceptedCandidates.filter((entry) => entry.candidate.category === category);
    const chosen = [];
    while (chosen.length < quota && pool.length) {
      pool.sort((left, right) => compareEntries(left, right, selectedSourceIds));
      const entry = pool.shift();
      chosen.push(entry);
      selected.push(entry.candidate);
      selectedSourceIds.add(entry.candidate.source.id);
    }
    for (const entry of pool) rejected.push(rejection(entry.candidate, 'category_quota_reached'));
  }
  balanceLanguages(selected, acceptedCandidates, rejected, quotas);
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, selected.filter((item) => item.category === category).length]));
  const shortages = CATEGORIES.filter((category) => counts[category] < Number(quotas[category] || 0)).map((category) => ({
    category,
    required: Number(quotas[category] || 0),
    selected: counts[category],
    missing: Number(quotas[category] || 0) - counts[category]
  }));
  return {
    schemaVersion: 'designsignal.selection.v1',
    id: deterministicId('sel', date, stableStringify(selected.map((item) => item.id))),
    date,
    algorithm: 'deterministic-quota-diversity-v1',
    dedupeWindowDays: 60,
    quotas: { ...quotas },
    counts,
    complete: shortages.length === 0,
    shortages,
    selected,
    rejected: dedupeRejections(rejected),
    auditSha256: sha256(
      stableStringify({
        date,
        selected: selected.map((item) => item.canonicalId),
        rejected: rejected.map((item) => [item.candidateId, item.reason])
      })
    )
  };
}

function candidateProblem(candidate) {
  if (!candidate || typeof candidate !== 'object') return 'candidate_invalid';
  if (!CATEGORIES.includes(candidate.category)) return 'category_invalid';
  if (!candidate.id || !candidate.canonicalId || !candidate.url) return 'identity_or_url_missing';
  if (!candidate.source?.id || !candidate.source?.name || !candidate.source?.url) return 'provenance_missing';
  if (!candidate.evidenceExcerpt?.zh && !candidate.evidenceExcerpt?.en) return 'evidence_missing';
  if (!candidate.provenance?.responseSha256 || !candidate.provenance?.fetchedAt) return 'fetch_provenance_missing';
  if (['product', 'ui'].includes(candidate.category) && !candidate.image?.url) return 'visual_evidence_missing';
  if (candidate.access?.loginRequired || candidate.access?.paywalled) return 'access_policy_rejected';
  return null;
}

function scoreCandidate(candidate, date) {
  const authority = {
    fixture_only: 70,
    publisher_page: 82,
    publisher_feed: 82,
    author_preprint: 80,
    aggregated_metadata: 76
  }[candidate.source.authority] || 60;
  const published = candidate.publishedAt ? new Date(candidate.publishedAt).getTime() : Number.NaN;
  const dayEnd = new Date(`${date}T23:59:59+08:00`).getTime();
  const ageDays = Number.isFinite(published) ? Math.max(0, (dayEnd - published) / 86_400_000) : 90;
  const freshness = Math.max(0, 20 - Math.min(20, ageDays / 3));
  const evidence = Math.min(8, Math.max(candidate.evidenceExcerpt.zh?.length || 0, candidate.evidenceExcerpt.en?.length || 0) / 150);
  const visual = candidate.image?.url ? 4 : 0;
  return Number((authority + freshness + evidence + visual).toFixed(4));
}

function compareEntries(left, right, usedSources) {
  const sourcePenalty = Number(usedSources.has(left.candidate.source.id)) - Number(usedSources.has(right.candidate.source.id));
  return (
    sourcePenalty ||
    right.score - left.score ||
    String(right.candidate.publishedAt || '').localeCompare(String(left.candidate.publishedAt || '')) ||
    left.key.localeCompare(right.key)
  );
}

function balanceLanguages(selected, entries, rejected, quotas) {
  const languages = new Set(selected.map((item) => item.language));
  for (const required of ['zh', 'en']) {
    if (languages.has(required)) continue;
    const replacement = entries
      .filter((entry) => entry.candidate.language === required && !selected.includes(entry.candidate))
      .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))[0];
    if (!replacement) continue;
    const replaceIndex = selected.findIndex(
      (item) =>
        item.category === replacement.candidate.category &&
        selected.filter((candidate) => candidate.language === item.language).length > 1
    );
    if (replaceIndex < 0 || selected.filter((item) => item.category === replacement.candidate.category).length > quotas[replacement.candidate.category])
      continue;
    rejected.push(rejection(selected[replaceIndex], 'language_diversity_rebalanced'));
    selected[replaceIndex] = replacement.candidate;
    languages.add(required);
  }
}

function recentHistoryKeys(history, date, days) {
  const cutoff = new Date(`${date}T00:00:00+08:00`).getTime() - days * 86_400_000;
  const keys = new Set();
  for (const record of history) {
    const recordDate = record.date || record.generatedAt || record.report?.date;
    const timestamp = recordDate ? new Date(String(recordDate).length === 10 ? `${recordDate}T00:00:00+08:00` : recordDate).getTime() : 0;
    if (timestamp && timestamp < cutoff) continue;
    const items = record.items || record.selected || record.selection?.selected || record.report?.items || [];
    for (const item of items) keys.add(candidateKey(item));
  }
  return keys;
}

export function candidateKey(candidate) {
  return cleanText(candidate?.canonicalId || candidate?.url || candidate?.id || titleText(candidate), 2000)
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
    .replace(/\s+/g, ' ');
}

function titleText(candidate) {
  return candidate?.title?.en || candidate?.title?.zh || '';
}

function rejection(candidate, reason) {
  return {
    sourceId: candidate?.source?.id || null,
    candidateId: candidate?.id || null,
    canonicalId: candidate?.canonicalId || null,
    category: candidate?.category || null,
    reason
  };
}

function dedupeRejections(rejections) {
  const seen = new Set();
  return rejections.filter((item) => {
    const key = `${item.sourceId || ''}:${item.candidateId || ''}:${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
