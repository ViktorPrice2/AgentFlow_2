import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_MODE = 'false';

import { ProviderManager, __testHooks } from '../src/core/ProviderManager.js';
import { ProxyManager } from '../src/core/ProxyManager.js';

const originalGetGeminiApiKey = ProxyManager.getGeminiApiKey;

test('ProviderManager uses sanitized prompt when Gemini blocks content', async t => {
  ProxyManager.getGeminiApiKey = () => 'test-key';

  const calls = [];
  __testHooks.setRequestHandler(async (_url, payload) => {
    const prompt = payload?.contents?.[0]?.parts?.[0]?.text || '';
    calls.push({ prompt, payload });

    if (calls.length === 1) {
      return {
        data: {
          candidates: [
            {
              content: { parts: [{ text: '' }] },
              safetyRatings: [{ blockReason: 'SAFETY' }],
            },
          ],
          promptFeedback: { blockReason: 'SAFETY' },
        },
      };
    }

    if (calls.length === 2) {
      return {
        data: {
          candidates: [
            {
              content: { parts: [{ text: '   ' }] },
              safetyRatings: [{ blockReason: 'SAFETY' }],
            },
          ],
          promptFeedback: { blockReason: 'SAFETY' },
        },
      };
    }

    return {
      data: {
        candidates: [
          {
            content: { parts: [{ text: 'Готовый безопасный текст.' }] },
          },
        ],
        usageMetadata: { totalTokenCount: 128 },
      },
    };
  });

  t.after(() => {
    __testHooks.reset();
    ProxyManager.getGeminiApiKey = originalGetGeminiApiKey;
  });

  const result = await ProviderManager.invoke(
    'gemini-2.5-flash',
    'Напиши статью в энтузиастичном тоне на тему «покорение Марса».',
    'text'
  );

  assert.equal(result.result, 'Готовый безопасный текст.');
  assert.equal(result.tokens, 128);
  assert.equal(result.modelUsed, 'gemini-2.5-flash');
  assert.ok(!result.warning);
  assert.ok(!result.isFallback);

  assert.equal(calls.length, 3);

  const [firstCall, secondCall, thirdCall] = calls;

  assert.deepEqual(firstCall.payload.safetySettings, [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_SEXUAL', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
  ]);

  assert.ok(secondCall.prompt.includes('Пожалуйста, сформулируй безопасный'));
  assert.ok(thirdCall.prompt.includes('Сформулируй нейтральный и безопасный текст'));
  assert.ok(
    thirdCall.prompt.includes('Напиши статью в энтузиастичном тоне на тему «покорение Марса».')
  );
});
