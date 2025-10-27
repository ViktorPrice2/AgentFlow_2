import fs from 'fs';
import path from 'path';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import '../utils/loadEnv.js';
import { resolveDataPath } from '../utils/appPaths.js';

const CONFIG_PATH = resolveDataPath('agentflow_settings.json');

const ALLOWED_HTTP_SCHEMES = new Set(['http', 'https']);

const DEFAULT_PROXY_CONFIG = {
  host: '',
  httpPort: null,
  httpScheme: 'http',
  socksPort: null,
  login: '',
  password: '',
};

let settings = loadSettings();

function ensureDataDir() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSettings() {
  try {
    ensureDataDir();
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return normalizeSettings(parsed);
    }
  } catch (error) {
    console.warn('[ProxyManager] Failed to read settings:', error.message);
  }
  return normalizeSettings({});
}

function normalizeScheme(value) {
  if (!value || typeof value !== 'string') {
    return DEFAULT_PROXY_CONFIG.httpScheme;
  }

  const lower = value.toLowerCase();
  if (ALLOWED_HTTP_SCHEMES.has(lower)) {
    return lower;
  }

  return DEFAULT_PROXY_CONFIG.httpScheme;
}

function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object') {
    raw = {};
  }

  let proxyPayload = raw.proxy || raw;
  if (proxyPayload && typeof proxyPayload !== 'object') {
    proxyPayload = {};
  }

  const proxy = {
    host: typeof proxyPayload.host === 'string' ? proxyPayload.host.trim() : '',
    httpPort: Number.parseInt(proxyPayload.httpPort, 10) || null,
    httpScheme: normalizeScheme(proxyPayload.httpScheme || proxyPayload.scheme),
    socksPort: Number.parseInt(proxyPayload.socksPort, 10) || null,
    login: typeof proxyPayload.login === 'string' ? proxyPayload.login.trim() : '',
    password: typeof proxyPayload.password === 'string' ? proxyPayload.password.trim() : '',
  };

  // если не было пользовательского ввода, подставим дефолт для первого запуска
  const hasUserConfig = Boolean(
    raw.proxy ||
      proxyPayload.host ||
      proxyPayload.httpPort ||
      proxyPayload.socksPort ||
      proxyPayload.login ||
      proxyPayload.password
  );

  const proxyConfig = hasUserConfig
    ? proxy
    : {
        ...DEFAULT_PROXY_CONFIG,
      };

  const geminiApiKey =
    typeof raw.geminiApiKey === 'string' && raw.geminiApiKey.trim()
      ? raw.geminiApiKey.trim()
      : process.env.GEMINI_API_KEY || '';

  applyEnvironmentVariables(proxyConfig);
  if (geminiApiKey) {
    process.env.GEMINI_API_KEY = geminiApiKey;
  }

  return { proxy: proxyConfig, geminiApiKey };
}

function saveSettings() {
  try {
    ensureDataDir();
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ proxy: settings.proxy, geminiApiKey: settings.geminiApiKey }, null, 2),
      'utf-8'
    );
  } catch (error) {
    console.warn('[ProxyManager] Failed to persist settings:', error.message);
  }
}

function encodeCredential(value) {
  return encodeURIComponent(value);
}

function buildAuthString(config, { encode = true } = {}) {
  if (!config) return '';
  if (config.login && config.password) {
    if (encode) {
      return `${encodeCredential(config.login)}:${encodeCredential(config.password)}@`;
    }
    return `${config.login}:${config.password}@`;
  }
  if (config.login && !config.password) {
    return encode ? `${encodeCredential(config.login)}@` : `${config.login}@`;
  }
  return '';
}

function buildProxyUrl(config) {
  const auth = buildAuthString(config, { encode: true });
  const scheme = config.httpScheme || DEFAULT_PROXY_CONFIG.httpScheme;
  return `${scheme}://${auth}${config.host}:${config.httpPort}`;
}

function applyEnvironmentVariables(config) {
  // очистим переменные, если конфиг выключен
  if (!config?.host) {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.ALL_PROXY;
    return;
  }

  if (config.httpPort) {
    const httpUrl = buildProxyUrl(config);
    process.env.HTTP_PROXY = httpUrl;
    process.env.HTTPS_PROXY = httpUrl;
  } else {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
  }

  if (config.socksPort) {
    const auth = buildAuthString(config);
    const socksUrl = `socks5://${auth}${config.host}:${config.socksPort}`;
    process.env.ALL_PROXY = socksUrl;
  } else if (!config.httpPort) {
    delete process.env.ALL_PROXY;
  }
}

function getProxyWithDefaults() {
  return { ...settings.proxy };
}

function getProxyClientConfig() {
  const proxy = getProxyWithDefaults();
  const hasProxy = proxy.host && proxy.httpPort;
  return {
    ...proxy,
    httpAuthString: hasProxy
      ? `${proxy.httpScheme || DEFAULT_PROXY_CONFIG.httpScheme}://${buildAuthString(proxy, { encode: false })}${
          proxy.host
        }:${proxy.httpPort}`
      : '',
  };
}

export const ProxyManager = {
  getConfig() {
    return { ...settings };
  },

  getProxyConfig() {
    return getProxyWithDefaults();
  },

  getClientConfig() {
    return getProxyClientConfig();
  },

  getGeminiApiKey() {
    return settings.geminiApiKey || process.env.GEMINI_API_KEY || '';
  },

  updateProxyConfig(partial = {}) {
    const merged = {
      ...settings.proxy,
      ...partial,
    };

    const normalized = {
      host: typeof merged.host === 'string' ? merged.host.trim() : '',
      httpPort: merged.httpPort ? Number.parseInt(merged.httpPort, 10) || null : null,
      httpScheme: normalizeScheme(merged.httpScheme || merged.scheme || settings.proxy.httpScheme),
      socksPort: merged.socksPort ? Number.parseInt(merged.socksPort, 10) || null : null,
      login: typeof merged.login === 'string' ? merged.login.trim() : '',
      password: typeof merged.password === 'string' ? merged.password.trim() : '',
    };

    settings.proxy = normalized;
    applyEnvironmentVariables(settings.proxy);
    saveSettings();
    return getProxyClientConfig();
  },

  updateConfig(partial) {
    return this.updateProxyConfig(partial);
  },

  updateGeminiApiKey(newKey) {
    const trimmed = typeof newKey === 'string' ? newKey.trim() : '';
    settings.geminiApiKey = trimmed;
    process.env.GEMINI_API_KEY = trimmed || '';
    saveSettings();
    return settings.geminiApiKey;
  },

  buildAxiosConfig() {
    const config = getProxyWithDefaults();
    if (!config.host) {
      return {};
    }

    if (config.httpPort) {
      if (config.httpScheme === 'https') {
        const httpUrl = buildProxyUrl(config);
        const agent = new HttpsProxyAgent(httpUrl);
        return {
          httpAgent: agent,
          httpsAgent: agent,
          proxy: false,
        };
      }

      const proxyConfig = {
        protocol: config.httpScheme || DEFAULT_PROXY_CONFIG.httpScheme,
        host: config.host,
        port: config.httpPort,
      };

      if (config.login) {
        proxyConfig.auth = {
          username: config.login,
          password: config.password || '',
        };
      }

      return { proxy: proxyConfig };
    }

    if (config.socksPort) {
      const auth = buildAuthString(config);
      const socksUrl = `socks5://${auth}${config.host}:${config.socksPort}`;
      const agent = new SocksProxyAgent(socksUrl);
      return {
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
      };
    }

    return {};
  },
};
