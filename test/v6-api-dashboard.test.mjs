import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { runDaily } from '../src/app.mjs';
import { startServer } from '../src/server.mjs';
import { fixtureConfig, temporaryDirectory } from './helpers.mjs';

test('readiness, run receipt, and outbox APIs expose only safe projections', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const secret = 'webhook-secret-v6';
  const config = {
    ...fixtureConfig(root, { dryRun: false, model: 'fixture-model', requiredChannel: 'feishu' }),
    apiKey: 'model-secret-v6',
    baseUrl: 'https://model.example.com/v1',
    allowedHosts: ['model.example.com', 'hooks.example.com'],
    host: '127.0.0.1',
    port: 0
  };
  await runDaily(config, {
    environment: { DESIGNSIGNAL_PUSH_CHANNELS: 'feishu', FEISHU_WEBHOOK_URL: `https://hooks.example.com/${secret}` },
    transport: async (url) =>
      url.endsWith('/responses')
        ? {
            status: 200,
            headers: { 'content-type': 'application/json' },
            bytes: Buffer.from(
              JSON.stringify({
                id: 'resp_api',
                output_text: JSON.stringify({
                  title: { zh: '标题', en: 'Title' },
                  summary: { zh: '摘要', en: 'Summary' },
                  evidence: { zh: '证据', en: 'Evidence' },
                  method: { zh: '方法', en: 'Method' },
                  novelty: { zh: '新意', en: 'Novelty' },
                  limits: { zh: '局限', en: 'Limits' },
                  whyLearn: { zh: '学习', en: 'Learn' },
                  studyAction: { zh: '动作', en: 'Action' },
                  mappings: [],
                  confidence: 0.8
                })
              })
            )
          }
        : { status: 200, headers: { 'content-type': 'application/json' }, bytes: Buffer.from(JSON.stringify({ code: 0 })) }
  });
  const service = await startServer(config);
  t.after(() => service.close());
  const readiness = await fetch(`${service.url}/api/readiness`);
  assert.equal(readiness.status, 200);
  const readinessValue = await readiness.json();
  assert.equal(readinessValue.schemaVersion, 'designsignal.readiness.v1');
  assert.equal(readinessValue.status, 'completed');
  assert.equal(JSON.stringify(readinessValue).includes(secret), false);
  assert.equal(JSON.stringify(readinessValue).includes('hooks.example.com'), false);

  const runs = await fetch(`${service.url}/api/runs/latest`);
  assert.equal(runs.status, 200);
  const receipt = await runs.json();
  assert.equal(receipt.schemaVersion, 'designsignal.run-receipt.v1');
  assert.equal(receipt.status, 'completed');
  assert.equal(JSON.stringify(receipt).includes(root), false);
  assert.equal(JSON.stringify(receipt).includes('model-secret-v6'), false);

  const outbox = await fetch(`${service.url}/api/outbox`);
  const outboxValue = await outbox.json();
  assert.equal(outboxValue.sent, 1);
  assert.equal(outboxValue.messages[0].status, 'sent');
  assert.equal('payload' in outboxValue.messages[0], false);
  assert.equal('endpoint' in outboxValue.messages[0], false);

  const page = await (await fetch(service.url)).text();
  assert.match(page, /运行就绪度/);
  assert.match(page, /Reliability loop/);
  assert.equal(page.includes(secret), false);
  assert.equal(page.includes('model-secret-v6'), false);
  assert.equal(page.includes('javascript:'), false);
});

test('fixture dashboard fallback keeps readiness visibly non-green until authoritative delivery exists', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { ...fixtureConfig(root), host: '127.0.0.1', port: 0 };
  const fallbackReport = (await import('../src/app.mjs')).runDaily(config).then((value) => value.report);
  const service = await startServer(config, { fallbackReport: await fallbackReport });
  t.after(() => service.close());
  const page = await (await fetch(service.url)).text();
  assert.match(page, /已完成但有缺口/);
  assert.match(page, /有缺口/);
});
