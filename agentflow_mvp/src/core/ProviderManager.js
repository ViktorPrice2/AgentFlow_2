import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import 'dotenv/config';

const getMockMode = () => process.env.MOCK_MODE === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1'; 
const GEMINI_IMAGE_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'; // Legacy /v1beta for Imagen

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
const RESULTS_DIR = path.join(process.cwd(), 'results');
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
  return { absolutePath, relativePath };
};

const createPlaceholderImage = async (model = 'imagen-3.0-generate') =>
  writeImageFile(model, Buffer.from(PLACEHOLDER_PIXEL_BASE64, 'base64'), 'image/png');

// --- Image API Call (FINAL, RELIABLE IMAGEN) ---
const invokeImageModel = async (model, prompt) => {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not set for image generation calls.');
    }

    const targetModel = 'imagen-3.0-generate';
    // Используем generateImages для большей надежности
    const url = `${GEMINI_IMAGE_API_BASE_URL}/models/${targetModel}:generateImages?key=${GEMINI_API_KEY}`;
    console.log(`[API CALL] Calling IMAGEN generateImages for prompt: ${prompt.substring(0, 30)}...`);
    
    const axiosConfig = {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
    };

    const payload = {
        prompt: prompt,
        config: {
            number_of_images: 1,
            output_mime_type: 'image/png',
            aspectRatio: '1:1'
        }
    };

    try {
        const response = await axios.post(url, payload, axiosConfig);

        const base64Data = response.data?.generated_images?.[0]?.image?.imageBytes;
        const mimeType = response.data?.generated_images?.[0]?.image?.mimeType || 'image/png';

        if (!base64Data) {
            const blockReason = response.data?.safetyFeedback?.[0]?.blockReason || 'No image data returned (safety block?).';
            throw new Error(`Imagen Generation Blocked: ${blockReason}`);
        }

        const buffer = Buffer.from(base64Data, 'base64');
        const { relativePath } = await writeImageFile(targetModel, buffer, mimeType);
        const tokens = response.data?.usageMetadata?.totalTokenCount || 0;
        
        return { result: { url: relativePath, mimeType }, tokens, modelUsed: targetModel };

    } catch (error) {
        // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: В случае сбоя API, возвращаем Placeholder Pixel и продолжаем работу
        logAxiosError(error, 'Image API - Failure');
        console.warn('[ImageAgent] API Failed. Reverting to Placeholder Pixel and continuing DAG.');
        const { relativePath, mimeType } = await createPlaceholderImage(targetModel);
        return { result: { url: relativePath, mimeType }, tokens: 0, modelUsed: 'MockPlaceholder' };
    }
};

export class ProviderManager {
  static async invoke(model, prompt, type = 'text') {
    if (getMockMode()) {
      if (type === 'image') {
        // Используем mock для image в mock-режиме
        const { relativePath } = await createPlaceholderImage(model);
        return { result: { url: relativePath, mimeType: 'image/png' }, tokens: 0 };
      }
      const mockText = `MOCK: ${model} generated content for: ${prompt.substring(0, 50)}...`;
      return { result: mockText, tokens: mockText.length / 4 };
    }

    if (type === 'image' || (typeof model === 'string' && model.includes('imagen'))) {
      return invokeImageModel(model, prompt);
    }

    // --- РЕАЛЬНЫЙ ВЫЗОВ GOOGLE GEMINI (TEXT) ---
    if (model.includes('gemini') || model.includes('gpt')) {
      if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not set for real API calls.');
      }

      const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      console.log(`[API CALL] Calling REAL ${model} for prompt: ${prompt.substring(0, 30)}...`);

      const axiosConfig = {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000, 
      };

      try {
          const response = await axios.post(url, {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          }, axiosConfig);
          
          if (!response.data.candidates || response.data.candidates.length === 0) {
              const blockReason = response.data.promptFeedback?.blockReason || 'API returned no candidates (possible block/safety reason).';
              throw new Error(`Gemini API Error: ${blockReason}`);
          }

          const text = response.data.candidates[0].content.parts[0].text;
          const usage = response.data.usageMetadata;
          const tokens = usage ? usage.totalTokenCount : text.length;
          
          return { result: text, tokens, modelUsed: model };
          
      } catch (error) {
          logAxiosError(error, 'Text API');
          throw new Error(`Request failed with status ${error.response?.status || 'Unknown'}. Details in console.`);
      }
    }
    
    throw new Error(`Provider not configured for model: ${model}`);
  }
}
