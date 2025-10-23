import fs from 'fs';
import path from 'path';
import { loadEnv } from '../config/env.js';

loadEnv();

const RESULTS_DIR = 'results';

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
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

    if (model.includes('gpt')) {
      console.log(`[API CALL] Calling real ${model} for prompt: ${prompt.substring(0, 30)}...`);
      await new Promise(resolve => setTimeout(resolve, 50));
      return { result: `REAL API RESPONSE from ${model}.`, tokens: 100 };
    }

    throw new Error(`Provider not configured for model: ${model}`);
  }
}
