import fs from 'fs';
import path from 'path';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import '../utils/loadEnv.js';
import { resolveDataPath } from '../utils/appPaths.js';

const PRIMARY_CONFIG_PATH = resolveDataPath('settings.json');
const LEGACY_CONFIG_PATH = resolveDataPath('agentflow_settings.json');

const LEGACY_DEFAULT_PROXY = {
  host: '181.215.71.182',
  httpPort: 7239,
  socksPort: 17239,
  login: 'user332599',
  password: 'hnakbz',
};

let settings = loadSettings();

function ensureDataDir(targetPath) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSettings() {
  try {
    const configPath = pickConfigPath();
    ensureDataDir(configPath);
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return normalizeSettings(parsed);
    }
  } catch (error) {
    console.warn('[ProxyManager] Failed to read settings:', error.message);
  }
  return normalizeSettings({});
}

function pickConfigPath() {
  if (fs.existsSync(PRIMARY_CONFIG_PATH)) {
    return PRIMARY_CONFIG_PATH;
  }
  return LEGACY_CONFIG_PATH;
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
    socksPort: Number.parseInt(proxyPayload.socksPort, 10) || null,
    login: typeof proxyPayload.login === 'string' ? proxyPayload.login.trim() : '',
    password: typeof proxyPayload.password === 'string' ? proxyPayload.password.trim() : '',
  };

  const proxyConfig = sanitizeProxyConfig(proxy);

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
    const targetPath = PRIMARY_CONFIG_PATH;
    ensureDataDir(targetPath);
    fs.writeFileSync(
      targetPath,
      JSON.stringify({ proxy: settings.proxy, geminiApiKey: settings.geminiApiKey }, null, 2),
      'utf-8'
    );
    if (LEGACY_CONFIG_PATH !== targetPath && fs.existsSync(LEGACY_CONFIG_PATH)) {
      try {
        fs.unlinkSync(LEGACY_CONFIG_PATH);
      } catch (unlinkError) {
        console.warn('[ProxyManager] Failed to remove legacy settings file:', unlinkError.message);
      }
    }
  } catch (error) {
    console.warn('[ProxyManager] Failed to persist settings:', error.message);
  }
}

function buildAuthString(config) {
  if (!config) return '';
  if (config.login && config.password) {
    return `${config.login}:${config.password}@`;
  }
  if (config.login && !config.password) {
    return `${config.login}@`;
  }
  return '';
}

function isLegacyDefaultProxy(config) {
  if (!config) return false;
  const sameHost = config.host === LEGACY_DEFAULT_PROXY.host;
  const sameHttp = (config.httpPort || null) === LEGACY_DEFAULT_PROXY.httpPort;
  const sameSocks = (config.socksPort || null) === LEGACY_DEFAULT_PROXY.socksPort;
  const sameLogin = config.login === LEGACY_DEFAULT_PROXY.login;
  const samePassword = config.password === LEGACY_DEFAULT_PROXY.password;
  return sameHost && sameHttp && sameSocks && sameLogin && samePassword;
}

function sanitizeProxyConfig(config) {
  const baseConfig = {
    host: config.host || '',
    httpPort: Number.isFinite(config.httpPort) ? config.httpPort : null,
    socksPort: Number.isFinite(config.socksPort) ? config.socksPort : null,
    login: config.login || '',
    password: config.password || '',
  };

  if (!baseConfig.host) {
    return { ...baseConfig, httpPort: null, socksPort: null, login: '', password: '' };
  }

  if (isLegacyDefaultProxy(baseConfig)) {
    return { host: '', httpPort: null, socksPort: null, login: '', password: '' };
  }

  return baseConfig;
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
    const auth = buildAuthString(config);
    const httpUrl = `http://${auth}${config.host}:${config.httpPort}`;
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
    httpAuthString: hasProxy ? `${buildAuthString(proxy)}${proxy.host}:${proxy.httpPort}` : '',
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
      socksPort: merged.socksPort ? Number.parseInt(merged.socksPort, 10) || null : null,
      login: typeof merged.login === 'string' ? merged.login.trim() : '',
      password: typeof merged.password === 'string' ? merged.password.trim() : '',
    };

    settings.proxy = sanitizeProxyConfig(normalized);
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
      const auth = buildAuthString(config);
      const proxyUrl = `http://${auth}${config.host}:${config.httpPort}`;
      const httpsAgent = new HttpsProxyAgent(proxyUrl);
      return {
        proxy: false,
        httpsAgent,
      };
    }

    if (config.socksPort) {
      const auth = buildAuthString(config);
      const socksUrl = `socks5://${auth}${config.host}:${config.socksPort}`;
      const agent = new SocksProxyAgent(socksUrl);
      return {
        proxy: false,
        httpAgent: agent,
        httpsAgent: agent,
      };
    }

    return {};
  },
};
