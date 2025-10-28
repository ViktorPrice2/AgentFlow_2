import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import '../utils/loadEnv.js';
import { resolveDataPath } from '../utils/appPaths.js';
import { GoogleGenAI } from '@google/genai';
import { ProxyManager } from './ProxyManager.js';

const getMockMode = () => process.env.MOCK_MODE === 'true';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1';

const getGeminiClient = () => {
  const apiKey = ProxyManager.getGeminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in settings.');
  return new GoogleGenAI({ apiKey });
};

const MAX_RETRIES = 5;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const logAxiosError = (error, contextLabel) => {
  if (error?.response) {
    console.error(
      `${contextLabel} response:`,
      JSON.stringify(error.response.data, null, 2),
      `\nError Status: ${error.response.status}`
    );
  } else if (error) {
    console.error(`${contextLabel} error:`, error.message);
  }
};

// --- Image Utilities ---
const RESULTS_DIR = resolveDataPath('results');
const PLACEHOLDER_PIXEL_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
const ensureResultsDir = async () => { await fs.mkdir(RESULTS_DIR, { recursive: true }); };
const extensionFromMimeType = mimeType => mimeType?.toLowerCase().includes('jpeg') ? 'jpg' : 'png';
const buildImageFileName = (model, mimeType = 'image/png') =>
  `${(model || 'imagen').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${extensionFromMimeType(mimeType)}`;

const writeImageFile = async (model, buffer, mimeType = 'image/png') => {
  await ensureResultsDir();
  const fileName = buildImageFileName(model, mimeType);
  const absolutePath = path.join(RESULTS_DIR, fileName);
  await fs.writeFile(absolutePath, buffer);
  const relativePath = path.posix.join('results', fileName);
  return { absolutePath, relativePath, mimeType };
};

const createPlaceholderImage = async (model = 'imagen-3.0-generate') =>
  writeImageFile(model, Buffer.from(PLACEHOLDER_PIXEL_BASE64, 'base64'), 'image/png');

const sendRequestWithRetries = async (url, payload, axiosConfig) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const proxyConfig = ProxyManager.getAxiosProxyConfig();
      const requestConfig = { ...axiosConfig, ...proxyConfig };
      const response = await axios.post(url, payload, requestConfig);
      return response;
    } catch (error) {
      const status = error.response?.status;
      const isRetryable =
        error.message?.includes('socket hang up') ||
        error.code === 'ECONNABORTED' ||
        status === 503 ||
        status === 500;

      if (isRetryable && attempt < MAX_RETRIES) {
        const backoffTime = 2 ** attempt * 1000; // 2s, 4s, 8s, 16s, 32s
        console.warn(
          `[API RETRY] Attempt ${attempt} of ${MAX_RETRIES} failed (${status || error.code || 'Timeout'}). Retrying in ${
            backoffTime / 1000
          }s...`
        );
        await delay(backoffTime);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Failed after ${MAX_RETRIES} attempts.`);
};

// --- SDK Image Call (FINAL, RELIABLE IMAGEN) ---
const invokeImageModel = async (model, prompt) => {
  if (getMockMode()) {
    const { relativePath, mimeType } = await createPlaceholderImage(model);
    return { result: { url: relativePath, mimeType }, tokens: 0, modelUsed: 'MockPlaceholder' };
  }

  const apiKey = ProxyManager.getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set for image generation calls.');
  }

  const ai = getGeminiClient();
  const targetModel = model || 'imagen-3.0-generate';
  console.log(`[API CALL] Calling SDK IMAGEN for prompt: ${prompt.substring(0, 30)}...`);

  try {
    const response = await ai.models.generateImages({
      model: targetModel,
      prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/png',
        aspectRatio: '1:1',
      },
    });

    const candidate = response.generatedImages?.[0];
    const base64Data = candidate?.image?.imageBytes;
    const mimeType = candidate?.image?.mimeType || 'image/png';

    if (!base64Data) {
      const blockReason = response.promptFeedback?.safetyRatings?.[0]?.blockReason || 'Image generation failed silently.';
      throw new Error(`SDK Imagen Generation Blocked: ${blockReason}`);
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const { relativePath } = await writeImageFile(targetModel, buffer, mimeType);
    const tokens = response.usageMetadata?.totalTokenCount || 0;

    return { result: { url: relativePath, mimeType }, tokens, modelUsed: targetModel };
  } catch (error) {
    logAxiosError(error, 'Image API - SDK Failure');
    console.warn('[ImageAgent] SDK Failed. Reverting to Placeholder Pixel and continuing DAG.');
    const { relativePath, mimeType } = await createPlaceholderImage(targetModel);
    return { result: { url: relativePath, mimeType }, tokens: 0, modelUsed: 'MockPlaceholder' };
  }
};

export class ProviderManager {
  static async invoke(model, prompt, type = 'text') {
    if (type === 'image' || (typeof model === 'string' && model.includes('imagen'))) {
      return invokeImageModel(model, prompt);
    }

    if (getMockMode()) {
      const mockText = `MOCK: ${model} generated content for: ${prompt.substring(0, 50)}...`;
      return { result: mockText, tokens: mockText.length / 4 };
    }

    // --- РЕАЛЬНЫЙ ВЫЗОВ GOOGLE GEMINI (TEXT) ---
    if (model.includes('gemini') || model.includes('gpt')) {
      const apiKey = ProxyManager.getGeminiApiKey();
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set in settings.');
      }

      const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${apiKey}`;
      console.log(`[API CALL] Calling REAL ${model} for prompt: ${prompt.substring(0, 30)}...`);

      const axiosConfig = {
        headers: { 'Content-Type': 'application/json' },
        timeout: 180000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      };

      const callGemini = async (promptText, safeAttempted = false) => {
        const payload = {
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.6,
            topP: 0.95,
            maxOutputTokens: 8192,
          },
          responseMimeType: 'text/plain',
          responseModalities: ['TEXT'],
        };

        try {
          const response = await sendRequestWithRetries(url, payload, axiosConfig);

          const candidates = response.data.candidates || [];
          if (candidates.length === 0) {
            const blockReason =
              response.data.promptFeedback?.blockReason ||
              'API returned no candidates (possible block/safety reason).';
            throw new Error(`Gemini API Error: ${blockReason}`);
          }

          const firstCandidateWithText = candidates.find(candidate =>
            candidate?.content?.parts?.some(part => typeof part?.text === 'string' && part.text.trim().length)
          );

          if (!firstCandidateWithText) {
            const blockReason =
              response.data.promptFeedback?.blockReason ||
              candidates[0]?.safetyRatings?.[0]?.blockReason ||
              'Candidates contained no text parts.';

            if (!safeAttempted) {
              console.warn('[ProviderManager] No textual content returned. Retrying with safe prompt instructions.');
              const safePrompt = `${promptText}\n\nПожалуйста, сформулируй безопасный, нейтральный ответ, избегая запрещённых и чувствительных тем.`;
              return callGemini(safePrompt, true);
            }

            throw new Error(`Gemini API Error: ${blockReason}`);
          }

          const textPart = firstCandidateWithText.content?.parts?.find(
            part => typeof part?.text === 'string' && part.text.trim().length
          );

          let text = textPart?.text;
          if (!text || !text.trim().length) {
            const aggregatedText = (firstCandidateWithText.content?.parts || [])
              .map(part => (typeof part?.text === 'string' ? part.text.trim() : ''))
              .filter(Boolean)
              .join('\n');

            if (aggregatedText && aggregatedText.trim().length) {
              text = aggregatedText.trim();
            } else {
              const blockReason =
                response.data.promptFeedback?.blockReason ||
                firstCandidateWithText?.safetyRatings?.[0]?.blockReason ||
                'Candidate parts missing textual content.';

              if (!safeAttempted) {
                console.warn('[ProviderManager] Candidate parts empty. Retrying with safe prompt instructions.');
                const safePrompt = `${promptText}\n\nПожалуйста, сформулируй безопасный, нейтральный ответ, избегая запрещённых и чувствительных тем.`;
                return callGemini(safePrompt, true);
              }

              throw new Error(`Gemini API Error: ${blockReason}`);
            }
          }

          const usage = response.data.usageMetadata;
          const tokens = usage ? usage.totalTokenCount : text.length;

          return { result: text, tokens, modelUsed: model };
        } catch (error) {
          logAxiosError(error, 'Text API - Failure');
          if (!safeAttempted) {
            console.warn('[ProviderManager] Text call failed. Retrying with safe prompt instructions.');
            const safePrompt = `${promptText}\n\nПожалуйста, сформулируй безопасный, нейтральный ответ, избегая запрещённых и чувствительных тем.`;
            return callGemini(safePrompt, true);
          }

          throw new Error(`Request failed with status ${error.response?.status || 'Unknown'}. Details in console.`);
        }
      };

      try {
        return await callGemini(prompt);
      } catch (error) {
        console.warn(`[ProviderManager] Falling back to safe stub after Gemini failure: ${error.message}`);
        const fallbackText = `Автоматическая генерация недоступна: ${error.message}. Подготовьте текст вручную или повторите позже.`;
        return {
          result: fallbackText,
          tokens: 0,
          modelUsed: `${model}-fallback`,
          warning: error.message,
          isFallback: true,
        };
      }
    }

    throw new Error(`Provider not configured for model: ${model}`);
  }
}
