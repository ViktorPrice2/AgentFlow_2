import fs from 'fs';
import path from 'path';
import https from 'https';
import { loadEnv } from '../config/env.js';

loadEnv();

const RESULTS_DIR = 'results';
const GEMINI_API_BASE = process.env.GEMINI_API_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta';

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function postJson(urlString, payload) {
  const url = new URL(urlString);
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      response => {
        let data = '';
        response.on('data', chunk => {
          data += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode || 0,
            body: data,
          });
        });
      }
    );

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function invokeGemini(model, prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const effectiveModel = model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Enable MOCK_MODE=true to avoid real API calls.');
  }

  const endpoint = `${GEMINI_API_BASE}/models/${effectiveModel}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  };

  const response = await postJson(endpoint, payload);
  let parsed;
  try {
    parsed = JSON.parse(response.body || '{}');
  } catch (error) {
    throw new Error(`Gemini response parse error: ${error.message}`);
  }

  if (response.status < 200 || response.status >= 300) {
    const message = parsed?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gemini text generation failed: ${message}`);
  }

  const parts = parsed?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map(part => part?.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini response did not contain any text content.');
  }

  const tokens = parsed?.usageMetadata?.totalTokenCount ?? Math.ceil(text.length / 4);
  return { text, tokens };
}

export class ProviderManager {
  static async invoke(model, prompt, type = 'text') {
    const mockMode = process.env.MOCK_MODE === 'true';

    if (mockMode) {
      if (type === 'image') {
        ensureResultsDir();
        const imageName = `${model}_${Math.random().toString(36).substring(2, 8)}.png`;
        const imagePath = path.join(RESULTS_DIR, imageName);
        return { result: { url: imagePath }, tokens: 0 };
      }
      const mockText = `MOCK: ${model} generated content for: ${prompt.substring(0, 50)}...`;
      return { result: mockText, tokens: Math.ceil(mockText.length / 4) };
    }

    if (type === 'text') {
      const { text, tokens } = await invokeGemini(model, prompt);
      return { result: text, tokens };
    }

    if (type === 'image') {
      // Placeholder implementation: Gemini image generation requires binary handling and is omitted here.
      // The system returns a deterministic placeholder path so downstream agents can proceed.
      ensureResultsDir();
      const imageName = `${model}_${Date.now()}.png`;
      const imagePath = path.join(RESULTS_DIR, imageName);
      return { result: { url: imagePath }, tokens: 0 };
    }

    throw new Error(`Provider not configured for model type: ${type}`);
  }
}
