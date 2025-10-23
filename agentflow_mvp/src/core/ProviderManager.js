// src/core/ProviderManager.js

import axios from 'axios';
import 'dotenv/config';

const MOCK_MODE = process.env.MOCK_MODE === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Добавим константу для базового URL
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class ProviderManager {
  static async invoke(model, prompt, type = 'text') {
    if (MOCK_MODE) {
      // ... (Оставить Mock-логику для image и text без изменений) ...
      if (type === 'image') {
        const imagePath = `results/imagen-3.0-generate_${Math.random().toString(36).substring(2, 8)}.png`;
        return { result: { url: imagePath }, tokens: 0 };
      }
      const mockText = `MOCK: ${model} generated content for: ${prompt.substring(0, 50)}...`;
      return { result: mockText, tokens: mockText.length / 4 };
    }

    // --- РЕАЛЬНЫЙ ВЫЗОВ GOOGLE GEMINI ---
    if (model.includes('gemini') || model.includes('gpt')) {
      if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not set for real API calls.');
      }

      const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      console.log(`[API CALL] Calling REAL ${model} for prompt: ${prompt.substring(0, 30)}...`);

      const response = await axios.post(url, {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.7 }
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      const text = response.data.candidates[0].content.parts[0].text;
      const usage = response.data.usageMetadata;
      const tokens = usage ? usage.totalTokenCount : text.length; // Приблизительный расчет, если нет метаданных
      
      return { result: text, tokens };
    }
    
    // Fallback для Image Agent (пока нет реального Image API)
    if (type === 'image') {
       // Используем Mock для DALL-E/Imagen, так как Gemini не делает изображения напрямую
       return this.invoke('imagen-3.0-generate', prompt, 'image'); 
    }

    throw new Error(`Provider not configured for model: ${model}`);
  }
}