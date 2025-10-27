import fs from 'fs';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { resolveDataPath } from '../utils/appPaths.js';

const SETTINGS_PATH = resolveDataPath('settings.json');
let settings = { proxy: {}, gemini: {} };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      settings = {
        proxy: parsed?.proxy && typeof parsed.proxy === 'object' ? parsed.proxy : {},
        gemini: parsed?.gemini && typeof parsed.gemini === 'object' ? parsed.gemini : {},
      };
    }
  } catch (error) {
    console.error('[ProxyManager] Failed to load settings:', error.message);
    settings = { proxy: {}, gemini: {} };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    console.error('[ProxyManager] Failed to save settings:', error.message);
  }
}

loadSettings(); // Загружаем при старте

export class ProxyManager {
  static getClientConfig() {
    return { ...settings.proxy };
  }

  static updateProxyConfig(config) {
    if (!settings.proxy || typeof settings.proxy !== 'object') {
      settings.proxy = {};
    }
    settings.proxy = {
      host: config.host || '',
      port: config.port || '',
      username: config.username || '',
      password: config.password || '',
    };
    saveSettings();
    return settings.proxy;
  }

  static getGeminiApiKey() {
    return settings.gemini?.apiKey || process.env.GEMINI_API_KEY || '';
  }

  static updateGeminiApiKey(apiKey) {
    if (!settings.gemini || typeof settings.gemini !== 'object') {
      settings.gemini = {};
    }
    settings.gemini.apiKey = apiKey || '';
    saveSettings();
    return settings.gemini.apiKey;
  }

  static getAxiosProxyConfig() {
    const { host, port, username, password } = settings.proxy;
    if (!host || !port) {
      return {};
    }

    const auth = username && password ? `${username}:${password}@` : '';
    const proxyUrl = `http://${auth}${host}:${port}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    return {
      httpsProxyAgent: agent,
      httpAgent: agent,
      httpsAgent: agent,
      proxy: false, // Отключаем стандартный axios proxy, чтобы использовался httpsProxyAgent
    };
  }
}
