import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSignal } from '../src/analyze.mjs';
import { fixtureSignals } from '../src/fixtures.mjs';

test('Responses API analysis requests strict structured JSON and preserves syllabus mappings', async () => {
  const [fixture] = fixtureSignals('2026-07-28');
  const item = {
    ...fixture,
    provenance: {
      fetchedAt: fixture.fetchedAt,
      responseSha256: 'a'.repeat(64)
    }
  };
  let request;
  const transport = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return {
      status: 200,
      bytes: Buffer.from(
        JSON.stringify({
          id: 'resp_fixture_123',
          output_text: JSON.stringify({
            title: item.title,
            summary: item.abstract,
            evidence: item.evidenceExcerpt,
            method: item.methodHint,
            novelty: { zh: '结构化新意', en: 'Structured novelty' },
            limits: { zh: '结构化局限', en: 'Structured limits' },
            whyLearn: { zh: '结构化学习价值', en: 'Structured learning value' },
            studyAction: { zh: '结构化学习动作', en: 'Structured study action' },
            mappings: item.mappings.map(() => ({
              reason: { zh: '保留考纲映射理由', en: 'Preserve syllabus mapping reason' },
              confidence: 0.77
            })),
            confidence: 0.81
          })
        })
      )
    };
  };

  const result = await analyzeSignal(
    item,
    {
      model: 'gpt-test',
      apiKey: 'sk-test-redacted',
      baseUrl: 'https://api.openai.com/v1',
      allowedHosts: [],
      timeoutMs: 1000,
      maxBytes: 100_000,
      retries: 0
    },
    { transport, now: () => new Date('2026-07-28T15:50:00.000Z') }
  );

  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.text.format.type, 'json_schema');
  assert.equal(request.body.text.format.strict, true);
  assert.equal(request.body.text.format.name, 'designsignal_analysis');
  assert.equal(result.analysis.model.status, 'completed');
  assert.equal(result.analysis.model.responseId, 'resp_fixture_123');
  assert.equal(result.confidence, 0.81);
  assert.equal(result.mappings[0].subject, item.mappings[0].subject);
  assert.equal(result.mappings[0].mappingVersion, item.mappings[0].mappingVersion);
  assert.equal(result.mappings[0].confidence, 0.77);
});
