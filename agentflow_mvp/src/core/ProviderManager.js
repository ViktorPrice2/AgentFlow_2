// src/core/ProviderManager.js

import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import 'dotenv/config';

const getMockMode = () => process.env.MOCK_MODE === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ИСПОЛЬЗУЕМ КОРРЕКТНУЮ V1 КОНЕЧНУЮ ТОЧКУ ДЛЯ ТЕКСТА
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1';
// А ДЛЯ ИЗОБРАЖЕНИЙ ПОКА ДОСТУПЕН ТОЛЬКО v1beta ЭНДПОИНТ
const GEMINI_IMAGE_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const RESULTS_DIR = path.join(process.cwd(), 'results');
const PLACEHOLDER_PIXEL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

const ensureResultsDir = async () => {
  await fs.mkdir(RESULTS_DIR, { recursive: true });
};

const sanitiseModelName = modelName =>
  (modelName || 'imagen-3.0-generate').replace(/[^a-z0-9._-]/gi, '_');

const extensionFromMimeType = mimeType => {
  if (!mimeType) return 'png';
  const [type, subtype] = mimeType.toLowerCase().split('/');
  if (type !== 'image' || !subtype) return 'png';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  return subtype.replace(/[^a-z0-9]/gi, '') || 'png';
};

const buildImageFileName = (model, mimeType = 'image/png') =>
  `${sanitiseModelName(model)}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${extensionFromMimeType(
    mimeType,
  )}`;

const writeImageFile = async (model, buffer, mimeType = 'image/png') => {
  await ensureResultsDir();
  const fileName = buildImageFileName(model, mimeType);
  const absolutePath = path.join(RESULTS_DIR, fileName);
  await fs.writeFile(absolutePath, buffer);
  const relativePath = path.posix.join('results', fileName);
  return { absolutePath, relativePath };
};

const createPlaceholderImage = async (model = 'imagen-3.0-generate') =>
  writeImageFile(model, Buffer.from(PLACEHOLDER_PIXEL_BASE64, 'base64'), 'image/png');

const downloadImageFromUri = async (fileUri, mimeTypeHint) => {
  if (!fileUri) {
    throw new Error('Missing file URI for image download.');
  }

  const urlWithKey = fileUri.includes('key=')
    ? fileUri
    : `${fileUri}${fileUri.includes('?') ? '&' : '?'}key=${GEMINI_API_KEY}`;

  const response = await axios.get(urlWithKey, {
    responseType: 'arraybuffer',
    timeout: 120000,
  });

  const mimeType = response.headers['content-type'] || mimeTypeHint || 'image/png';
  return { buffer: Buffer.from(response.data), mimeType };
};

const invokeImageModel = async (model, prompt) => {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set for image generation calls.');
  }

  const url = `${GEMINI_IMAGE_API_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };

  const axiosConfig = {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
  };

  try {
    const response = await axios.post(url, payload, axiosConfig);
    const candidate = response.data?.candidates?.[0];
    const usage = response.data?.usageMetadata;

    if (!candidate?.content?.parts?.length) {
      const blockReason = response.data?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new Error(`Gemini image generation blocked: ${blockReason}`);
      }
      throw new Error('Gemini image API returned no candidates.');
    }

    const part = candidate.content.parts.find(p => p.inlineData || p.fileData);
    if (!part) {
      throw new Error('Gemini image API response did not contain image data.');
    }

    let buffer;
    let mimeType;

    if (part.inlineData?.data) {
      buffer = Buffer.from(part.inlineData.data, 'base64');
      mimeType = part.inlineData.mimeType || 'image/png';
    } else if (part.fileData?.fileUri) {
      const download = await downloadImageFromUri(part.fileData.fileUri, part.fileData.mimeType);
      buffer = download.buffer;
      mimeType = download.mimeType;
    }

    if (!buffer) {
      throw new Error('Unable to resolve image binary from Gemini response.');
    }

    const { relativePath } = await writeImageFile(model, buffer, mimeType);
    const tokens = usage?.totalTokenCount || 0;
    return { result: { url: relativePath, mimeType }, tokens };
  } catch (error) {
    if (error.response) {
      console.error('Gemini image API response:', JSON.stringify(error.response.data, null, 2));
      throw new Error(`Image request failed with status ${error.response.status}. Details in console.`);
    }
    throw error;
  }
};

export class ProviderManager {
  static async invoke(model, prompt, type = 'text') {
    if (getMockMode()) {
      if (type === 'image') {
        const { relativePath } = await createPlaceholderImage(model);
        return { result: { url: relativePath, mimeType: 'image/png' }, tokens: 0 };
      }
      const mockText = `MOCK: ${model} generated content for: ${prompt.substring(0, 50)}...`;
      return { result: mockText, tokens: mockText.length / 4 };
    }

    if (type === 'image' || (typeof model === 'string' && model.includes('imagen'))) {
      return invokeImageModel(model, prompt);
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
