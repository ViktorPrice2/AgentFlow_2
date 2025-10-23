// src/core/ProviderManager.js

import axios from 'axios';
import 'dotenv/config';

const getMockMode = () => process.env.MOCK_MODE === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ИСПОЛЬЗУЕМ КОРРЕКТНУЮ V1 КОНЕЧНУЮ ТОЧКУ
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1'; 

export class ProviderManager {
  static async invoke(model, prompt, type = 'text') {
    if (getMockMode()) {
      // ... (Оставить Mock-логику без изменений) ...
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

      // ИСПОЛЬЗУЕМ ПРАВИЛЬНЫЙ ЭНДПОИНТ: generateContent
      const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      console.log(`[API CALL] Calling REAL ${model} for prompt: ${prompt.substring(0, 30)}...`);

      try {
          const response = await axios.post(url, {
            // КОРРЕКТНАЯ СТРУКТУРА PAYLOAD для generateContent
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              temperature: 0.7,
            },
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000, // Таймаут для предотвращения socket hang up
          });
          
          // Проверка на ошибку от API, которая не возвращает 400
          if (!response.data.candidates || response.data.candidates.length === 0) {
              const errorMessage = response.data.promptFeedback?.blockReason || 'API returned no candidates (possible block/safety reason).';
              throw new Error(`Gemini API Error: ${errorMessage}`);
          }

          const text = response.data.candidates[0].content.parts[0].text;
          const usage = response.data.usageMetadata;
          const tokens = usage ? usage.totalTokenCount : text.length;
          
          return { result: text, tokens };
          
      } catch (error) {
          // Выводим полный ответ, чтобы увидеть причину ошибки 400
          if (error.response) {
              console.error('Gemini API 400 Response Body:', JSON.stringify(error.response.data, null, 2));
              throw new Error(`Request failed with status ${error.response.status}. Details in console.`);
          }
          throw error;
      }
    }
    
    // Fallback для Image Agent (оставляем Mock)
    if (type === 'image') {
       return this.invoke('imagen-3.0-generate', prompt, 'image'); 
    }

    throw new Error(`Provider not configured for model: ${model}`);
  }
}
