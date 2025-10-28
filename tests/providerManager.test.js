import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_MODE = 'false';

import { ProviderManager, __testHooks } from '../src/core/ProviderManager.js';
import { ProxyManager } from '../src/core/ProxyManager.js';

const originalGetGeminiApiKey = ProxyManager.getGeminiApiKey;

test('ProviderManager uses sanitized prompt when Gemini blocks content', async t => {
  ProxyManager.getGeminiApiKey = () => 'test-key';

  const prompts = [];
  __testHooks.setRequestHandler(async (_url, payload) => {
    const prompt = payload?.contents?.[0]?.parts?.[0]?.text || '';
    prompts.push(prompt);

    if (prompts.length === 1) {
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

    if (prompts.length === 2) {
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

  assert.equal(prompts.length, 3);
  assert.ok(prompts[1].includes('Пожалуйста, сформулируй безопасный'));
  assert.ok(prompts[2].includes('Сформулируй нейтральный и безопасный текст'));
});
