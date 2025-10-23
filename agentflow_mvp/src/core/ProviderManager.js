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

const shouldAttemptImageFallback = error => {
  if (!error || !error.response) return false;

  const status = error.response.status;
  const message = String(error.response.data?.error?.message || '').toLowerCase();

  if ([404, 405, 501].includes(status)) {
    return true;
  }

  if (status === 400) {
    if (
      message.includes('text_prompts') ||
      message.includes('unknown name') ||
      message.includes('unsupported field') ||
      message.includes('invalid argument')
    ) {
      return true;
    }
  }

  return (
    message.includes('not found') ||
    message.includes('generatecontent') ||
    message.includes('unsupported for this method') ||
    message.includes('method not found')
  );
};

const logAxiosError = (error, contextLabel) => {
  if (error?.response) {
    console.error(
      `${contextLabel} response:`,
      JSON.stringify(error.response.data, null, 2)
    );
  } else if (error) {
    console.error(`${contextLabel} error:`, error.message);
  }
};

const formatAxiosError = (error, defaultMessage) => {
  if (error?.response) {
    logAxiosError(error, 'Gemini image API');
    return new Error(`${defaultMessage} with status ${error.response.status}. Details in console.`);
  }
  return error instanceof Error ? error : new Error(defaultMessage);
};

const collectLegacyImageCandidates = baseModel => {
  const candidates = new Set();
  const base = baseModel || 'imagen-3.0-generate';
  candidates.add(base);
  if (base.endsWith('-generate')) {
    const stripped = base.replace(/-generate$/, '');
    if (stripped) {
      candidates.add(stripped);
      candidates.add(`${stripped}-latest`);
    }
  }
  candidates.add('imagen-3.0');
  candidates.add('imagen-3.0-latest');
  candidates.add('imagegeneration');
  return Array.from(candidates);
};

const extractBase64Image = data => {
  if (!data) return null;
  const collections = [];
  if (Array.isArray(data.images)) collections.push(data.images);
  if (Array.isArray(data.result?.images)) collections.push(data.result.images);
  if (Array.isArray(data.predictions)) collections.push(data.predictions);
  if (Array.isArray(data.generatedImages)) collections.push(data.generatedImages);
  if (Array.isArray(data.generated_images)) collections.push(data.generated_images);
  if (Array.isArray(data.outputs)) collections.push(data.outputs);
  if (Array.isArray(data.output?.images)) collections.push(data.output.images);

  for (const list of collections) {
    for (const item of list) {
      if (!item) continue;

      let mimeType =
        item.mimeType ||
        item.mime_type ||
        item.image?.mimeType ||
        item.image?.mime_type ||
        item.media?.mimeType ||
        item.media?.mime_type ||
        item.output?.mimeType ||
        item.output?.mime_type ||
        undefined;

      if (item.inlineData?.mimeType && !mimeType) {
        mimeType = item.inlineData.mimeType;
      }

      const containers = [item, item.image, item.media, item.output, item.generatedImage, item.result].filter(Boolean);

      for (const container of containers) {
        const base64 =
          container?.inlineData?.data ||
          container?.base64Data ||
          container?.base64_data ||
          container?.imageBytes ||
          container?.image_bytes ||
          container?.bytesBase64Encoded ||
          container?.bytes_base64_encoded ||
          container?.b64_json ||
          container?.b64Json ||
          container?.data;
        if (base64) {
          return { base64, mimeType: mimeType || container?.mimeType || container?.mime_type || 'image/png' };
        }
      }

      const fileUri =
        item.fileUri ||
        item.file_uri ||
        item.uri ||
        item.imageUri ||
        item.image_uri ||
        item.image?.uri ||
        item.image?.imageUri ||
        item.media?.uri ||
        item.media?.imageUri;

      if (fileUri) {
        return { fileUri, mimeType: mimeType || 'image/png' };
      }
    }
  }
  return null;
};

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

const extractSafetyBlockReason = data => {
  const possibleCollections = [];
  const promptFeedback = data?.promptFeedback;
  if (promptFeedback) {
    possibleCollections.push(promptFeedback);
    if (Array.isArray(promptFeedback.safetyRatings)) {
      possibleCollections.push(...promptFeedback.safetyRatings);
    }
  }

  if (Array.isArray(data?.result?.safetyFeedback)) {
    possibleCollections.push(...data.result.safetyFeedback);
  }
  if (Array.isArray(data?.safetyFeedback)) {
    possibleCollections.push(...data.safetyFeedback);
  }

  for (const entry of possibleCollections) {
    if (!entry) continue;
    const blockReason = entry.blockReason || entry.block_reason;
    if (blockReason) {
      return blockReason;
    }
    if (entry.blocked === true && entry.category) {
      return `${entry.category} blocked`;
    }
    if (entry.reason) {
      return entry.reason;
    }
  }
  return null;
};

const callGenerateContentImage = async (model, prompt, axiosConfig) => {
  const url = `${GEMINI_IMAGE_API_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };

  const response = await axios.post(url, payload, axiosConfig);
  const candidate = response.data?.candidates?.[0];
  const usage = response.data?.usageMetadata;

  if (!candidate?.content?.parts?.length) {
    const blockReason = extractSafetyBlockReason(response.data) || 'no candidates';
    throw new Error(`Gemini image generation blocked: ${blockReason}`);
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
  return { result: { url: relativePath, mimeType }, tokens, modelUsed: model };
};

const callLegacyImagenGenerate = async (model, prompt, axiosConfig) => {
  const url = `${GEMINI_IMAGE_API_BASE_URL}/models/${model}:generate?key=${GEMINI_API_KEY}`;
  const payload = {
    text_prompts: [{ text: prompt }],
  };

  const response = await axios.post(url, payload, axiosConfig);
  const blockReason = extractSafetyBlockReason(response.data);
  if (blockReason) {
    throw new Error(`Gemini image generation blocked: ${blockReason}`);
  }

  const extracted = extractBase64Image(response.data);
  if (!extracted) {
    throw new Error('Legacy Imagen API response did not contain image data.');
  }

  let buffer = null;
  let mimeType = extracted.mimeType;

  if (extracted.base64) {
    buffer = Buffer.from(extracted.base64, 'base64');
  } else if (extracted.fileUri) {
    const download = await downloadImageFromUri(extracted.fileUri, extracted.mimeType);
    buffer = download.buffer;
    mimeType = download.mimeType;
  }

  if (!buffer) {
    throw new Error('Unable to resolve image binary from legacy Imagen response.');
  }

  const { relativePath } = await writeImageFile(model, buffer, mimeType);
  const tokens = response.data?.usageMetadata?.totalTokenCount || 0;
  return { result: { url: relativePath, mimeType: mimeType || 'image/png' }, tokens, modelUsed: model };
};

const callImageGenerationEndpoint = async (prompt, axiosConfig) => {
  const model = 'imagegeneration';
  const url = `${GEMINI_IMAGE_API_BASE_URL}/models/${model}:generate?key=${GEMINI_API_KEY}`;
  const payloadVariants = [
    { prompt: { text: prompt } },
    { textPrompt: { text: prompt } },
    { text_prompts: [{ text: prompt }] },
  ];

  let lastError = null;

  for (const payload of payloadVariants) {
    try {
      const response = await axios.post(url, payload, axiosConfig);

      const blockReason = extractSafetyBlockReason(response.data);
      if (blockReason) {
        throw new Error(`Gemini image generation blocked: ${blockReason}`);
      }

      const extracted = extractBase64Image(response.data);
      if (!extracted) {
        throw new Error('Imagegeneration API response did not contain image data.');
      }

      let buffer = null;
      let mimeType = extracted.mimeType;

      if (extracted.base64) {
        buffer = Buffer.from(extracted.base64, 'base64');
      } else if (extracted.fileUri) {
        const download = await downloadImageFromUri(extracted.fileUri, extracted.mimeType);
        buffer = download.buffer;
        mimeType = download.mimeType;
      }

      if (!buffer) {
        throw new Error('Unable to resolve image binary from imagegeneration response.');
      }

      const resolvedModel = response.data?.modelVersion || model;
      const { relativePath } = await writeImageFile(resolvedModel, buffer, mimeType);
      const tokens = response.data?.usageMetadata?.totalTokenCount || 0;
      return { result: { url: relativePath, mimeType: mimeType || 'image/png' }, tokens, modelUsed: resolvedModel };
    } catch (error) {
      lastError = error;
      if (!shouldAttemptImageFallback(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Imagegeneration endpoint failed with unknown error.');
};

const invokeImageModel = async (model, prompt) => {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set for image generation calls.');
  }

  const axiosConfig = {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
  };

  const targetModel = model || 'imagen-3.0-generate';

  try {
    return await callGenerateContentImage(targetModel, prompt, axiosConfig);
  } catch (error) {
    if (!shouldAttemptImageFallback(error)) {
      throw formatAxiosError(error, 'Image request failed');
    }

    console.warn(
      `[ProviderManager] Falling back to alternate Gemini image endpoints for model ${targetModel} (generateContent unsupported).`
    );

    const candidates = collectLegacyImageCandidates(targetModel);
    let lastError = error;

    for (const candidate of candidates) {
      try {
        if (candidate === 'imagegeneration') {
          console.warn('[ProviderManager] Switching to imagegeneration endpoint fallback.');
          return await callImageGenerationEndpoint(prompt, axiosConfig);
        }

        console.warn(
          `[ProviderManager] Trying legacy Imagen fallback model ${candidate} via :generate endpoint.`,
        );
        return await callLegacyImagenGenerate(candidate, prompt, axiosConfig);
      } catch (legacyError) {
        lastError = legacyError;
        if (!shouldAttemptImageFallback(legacyError)) {
          throw formatAxiosError(legacyError, 'Image request failed');
        }
      }
    }

    throw formatAxiosError(lastError, 'Image request failed after fallback attempts');
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
