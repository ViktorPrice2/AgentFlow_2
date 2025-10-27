import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import '../utils/loadEnv.js';
import { resolveDataPath } from '../utils/appPaths.js';

const CONFIG_PATH = resolveDataPath('agentflow_settings.json');

const DEFAULT_PROXY_CONFIG = {
  host: '102.129.221.246',
  httpPort: 7239,
  socksPort: 17239,
  login: 'user332599',
  password: 'hnakbz',
};

let settings = loadSettings();

const moduleRequire = createRequire(path.join(process.cwd(), 'agentflow.require.cjs'));
const SOCKS_MODULE_NAME = process.env.AGENTFLOW_SOCKS_MODULE || 'socks-proxy-agent';
let cachedSocksProxyAgent = undefined;

const resolveSocksProxyAgent = () => {
  if (cachedSocksProxyAgent !== undefined) {
    return cachedSocksProxyAgent;
  }

  try {
    const required = moduleRequire(SOCKS_MODULE_NAME);
    const resolved = required?.SocksProxyAgent || required?.default || required;
    if (typeof resolved !== 'function') {
      throw new Error('SocksProxyAgent export is not a constructor');
    }
    cachedSocksProxyAgent = resolved;
  } catch (error) {
    cachedSocksProxyAgent = null;
    console.warn(
      `[ProxyManager] SOCKS proxy support disabled (${error.message}). ` +
        `Install "${SOCKS_MODULE_NAME}" to enable SOCKS5 tunnelling.`
    );
  }

  return cachedSocksProxyAgent;
};

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
      const axiosProxy = {
        host: config.host,
        port: Number.parseInt(config.httpPort, 10),
      };
      if (config.login) {
        axiosProxy.auth = {
          username: config.login,
          password: config.password || '',
        };
      }
      return { proxy: axiosProxy };
    }

    if (config.socksPort) {
      const SocksProxyAgent = resolveSocksProxyAgent();
      if (!SocksProxyAgent) {
        return {};
      }

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
