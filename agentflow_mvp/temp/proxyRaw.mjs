import axios from 'axios';
import { ProxyManager } from '../src/core/ProxyManager.js';

async function main() {
  const prompt = 'Напиши статью в энтузиастичном тоне про преимущества мультиагентных систем.';
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
  };
  const config = ProxyManager.buildAxiosConfig();
  try {
    const res = await axios.post(
      'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=AIzaSyBUQPuEZRuGnxcXEeepDy8wWf4uHmv3mrI',
      body,
      {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' },
        ...config,
      },
    );
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.log('Error code:', err.code);
    console.log('Message:', err.message);
    if (err.response) {
      console.log('HTTP status:', err.response.status);
      console.log('Response data:', JSON.stringify(err.response.data, null, 2));
    }
  }
}

main();
