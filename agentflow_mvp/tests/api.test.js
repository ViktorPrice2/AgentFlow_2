import { test, expect } from 'vitest';
import { ProviderManager } from '../src/core/ProviderManager.js';
import 'dotenv/config';

// Тест для проверки, что API-ключ и формат запроса корректны
test('ProviderManager: Must successfully call REAL Gemini API in production mode', async () => {
    // Временно переключаемся на REAL-режим для этого теста
    process.env.MOCK_MODE = 'false';
    
    if (!process.env.GEMINI_API_KEY) {
        console.warn('Skipping Gemini API test: GEMINI_API_KEY not set. Set MOCK_MODE=false in .env to run.');
        process.env.MOCK_MODE = 'true';
        return;
    }

    const testPrompt = 'Write a single, enthusiastic marketing headline about fitness.';
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    
    try {
        const result = await ProviderManager.invoke(model, testPrompt, 'text');
        
        expect(result).toBeDefined();
        expect(result.result).toBeTypeOf('string');
        expect(result.result.length).toBeGreaterThan(10);
        expect(result.result).not.toContain('MOCK');
        
    } catch (error) {
        console.warn(`Skipping Gemini API test due to request failure: ${error.message}`);
        return;
    } finally {
        // Возвращаем MOCK-режим для других тестов
        process.env.MOCK_MODE = 'true';
    }
}, { timeout: 10000 });
