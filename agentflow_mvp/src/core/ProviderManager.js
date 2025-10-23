// src/core/ProviderManager.js

import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import 'dotenv/config';

const getMockMode = () => process.env.MOCK_MODE === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ИСПОЛЬЗУЕМ КОРРЕКТНУЮ V1 КОНЕЧНУЮ ТОЧКУ
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1';

const RESULTS_DIR = path.join(process.cwd(), 'results');
const PLACEHOLDER_PIXEL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

const ensureResultsDir = async () => {
  await fs.mkdir(RESULTS_DIR, { recursive: true });
};

const sanitiseModelName = modelName =>
  (modelName || 'imagen-3.0-generate').replace(/[^a-z0-9._-]/gi, '_');

const buildImageFileName = model =>
  `${sanitiseModelName(model)}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`;

const createPlaceholderImage = async (model = 'imagen-3.0-generate') => {
  const fileName = buildImageFileName(model);
  await ensureResultsDir();
  const absolutePath = path.join(RESULTS_DIR, fileName);
  await fs.writeFile(absolutePath, Buffer.from(PLACEHOLDER_PIXEL_BASE64, 'base64'));
  const relativePath = path.posix.join('results', fileName);
  return { absolutePath, relativePath };
};

export class ProviderManager {
  static async invoke(model, prompt, type = 'text') {
    if (getMockMode()) {
      if (type === 'image') {
        const { relativePath } = await createPlaceholderImage(model);
        return { result: { url: relativePath }, tokens: 0 };
      }
      const mockText = `MOCK: ${model} generated content for: ${prompt.substring(0, 50)}...`;
      return { result: mockText, tokens: mockText.length / 4 };
    }

    if (type === 'image' || (typeof model === 'string' && model.includes('imagen'))) {
      const { relativePath } = await createPlaceholderImage(model);
      return { result: { url: relativePath }, tokens: 0 };
    }

    // --- РЕАЛЬНЫЙ ВЫЗОВ GOOGLE GEMINI ---
    if (model.includes('gemini') || model.includes('gpt')) {
      if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not set for real API calls.');
      }

      // ИСПОЛЬЗУЕМ ПРАВИЛЬНЫЙ ЭНДПОИНТ: generateContent
      const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      console.log(`[API CALL] Calling REAL ${model} for prompt: ${prompt.substring(0, 30)}...`);

      const axiosConfig = {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000, // Таймаут для предотвращения socket hang up
      };

      const payload = {
        // КОРРЕКТНАЯ СТРУКТУРА PAYLOAD для generateContent
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
        },
      };

      const sendRequest = async body => {
        const response = await axios.post(url, body, axiosConfig);

        if (!response.data.candidates || response.data.candidates.length === 0) {
          const errorMessage = response.data.promptFeedback?.blockReason || 'API returned no candidates (possible block/safety reason).';
          throw new Error(`Gemini API Error: ${errorMessage}`);
        }

        const text = response.data.candidates[0].content.parts[0].text;
        const usage = response.data.usageMetadata;
        const tokens = usage ? usage.totalTokenCount : text.length;

        return { result: text, tokens };
      };

      try {
        return await sendRequest(payload);
      } catch (error) {
        const message = error.response?.data?.error?.message || '';
        const isConfigFieldError =
          error.response?.status === 400 && /Unknown name "config"/i.test(message);

        if (isConfigFieldError) {
          console.warn('[ProviderManager] Gemini rejected generationConfig payload. Retrying without optional config block.');
          try {
            const fallbackPayload = { ...payload };
            delete fallbackPayload.generationConfig;
            return await sendRequest(fallbackPayload);
          } catch (fallbackError) {
            if (fallbackError.response) {
              console.error('Gemini API 400 Response Body:', JSON.stringify(fallbackError.response.data, null, 2));
              throw new Error(`Request failed with status ${fallbackError.response.status}. Details in console.`);
            }
            throw fallbackError;
          }
        }

        if (error.response) {
          console.error('Gemini API 400 Response Body:', JSON.stringify(error.response.data, null, 2));
          throw new Error(`Request failed with status ${error.response.status}. Details in console.`);
        }
        throw error;
      }
    }
    
    throw new Error(`Provider not configured for model: ${model}`);
  }
}
