    const candidates = joinWithRoot(root, segments);
    for (const candidate of candidates) {
      let exists = false;
      try {
        exists = import_fs.default.existsSync(candidate);
      } catch (error) {
        exists = false;
        if (DEBUG_PATHS) {
          console.log("[AgentFlow][Paths][probe-error]", candidate, error.message);
        }
      }
      if (DEBUG_PATHS) {
        console.log("[AgentFlow][Paths][probe]", candidate, exists);
      }
      if (exists) {
        return candidate;
      }
  const fallbackCandidates = joinWithRoot(EXEC_ROOT, segments);
  return fallbackCandidates[0] || import_path.default.join(EXEC_ROOT, ...segments);
var import_fs, import_path, import_url, import_meta, ROOT_HINT, SNAPSHOT_PREFIX, isSnapshotPath, normalizeSnapshotValue, toAbsoluteIfPossible, deriveSnapshotRoot, moduleDir, MODULE_ROOT, DEFAULT_ROOT, EXEC_ROOT, SNAPSHOT_ROOT, expandSnapshotCandidate, joinWithRoot, addCandidate, pickWritableRoot, DATA_ROOT, buildAssetRoots, ASSET_ROOTS, DEBUG_PATHS, resolveAssetPath, resolveDataPath;
    import_url = require("url");
    import_meta = {};
    SNAPSHOT_PREFIX = "snapshot:";
    isSnapshotPath = (value) => typeof value === "string" && value.startsWith(SNAPSHOT_PREFIX);
    normalizeSnapshotValue = (value) => {
      if (!value) {
        return null;
      }
      const raw = value.replace(/\\/g, "/");
      const withoutPrefix = raw.startsWith(SNAPSHOT_PREFIX) ? raw.slice(SNAPSHOT_PREFIX.length) : raw;
      const trimmed = withoutPrefix.startsWith("/") ? withoutPrefix : `/${withoutPrefix}`;
      return `${SNAPSHOT_PREFIX}${trimmed}`;
    };
    toAbsoluteIfPossible = (candidate) => {
      if (!candidate) {
        return null;
      }
      if (isSnapshotPath(candidate)) {
        return normalizeSnapshotValue(candidate);
      }
      return import_path.default.resolve(candidate);
    };
    deriveSnapshotRoot = () => {
      if (!process.pkg) {
        return null;
      }
      const entry = process.pkg.defaultEntrypoint || process.pkg.entrypoint;
      if (!entry) {
        return null;
      }
      if (isSnapshotPath(entry) || entry.startsWith("/snapshot")) {
        return import_path.default.posix.dirname(normalizeSnapshotValue(entry));
      }
      if (entry.startsWith("file://")) {
        return normalizeSnapshotValue((0, import_url.fileURLToPath)(entry));
      }
      return import_path.default.dirname(entry);
    };
    moduleDir = null;
    try {
      const currentFile = (0, import_url.fileURLToPath)(import_meta.url);
      moduleDir = import_path.default.dirname(currentFile);
    } catch (error) {
      moduleDir = null;
    }
    MODULE_ROOT = moduleDir ? import_path.default.resolve(moduleDir, "..", "..") : null;
    DEFAULT_ROOT = MODULE_ROOT || import_path.default.resolve(process.cwd());
    EXEC_ROOT = process.pkg ? import_path.default.dirname(process.execPath) : ROOT_HINT ? import_path.default.resolve(ROOT_HINT) : DEFAULT_ROOT;
    SNAPSHOT_ROOT = deriveSnapshotRoot() || MODULE_ROOT || EXEC_ROOT;
    expandSnapshotCandidate = (candidate) => {
      if (!candidate || !isSnapshotPath(candidate)) {
        return [candidate].filter(Boolean);
      }
      const normalized = normalizeSnapshotValue(candidate);
      const results = [normalized];
      const mountpoint = process.pkg?.mountpoint;
      if (mountpoint) {
        const resolvedMount = import_path.default.resolve(mountpoint);
        const relative = normalized.slice(SNAPSHOT_PREFIX.length).replace(/^\/+/, "");
        const expanded = import_path.default.join(resolvedMount, relative);
        if (!results.includes(expanded)) {
          results.unshift(expanded);
        }
      }
      return results;
    };
    joinWithRoot = (root, segments) => {
      if (!root) {
        return [];
      }
      const normalizedRoot = toAbsoluteIfPossible(root);
      if (!normalizedRoot) {
        return [];
      }
      if (isSnapshotPath(normalizedRoot)) {
        const joined2 = segments.reduce(
          (acc, segment) => import_path.default.posix.join(acc, segment),
          normalizedRoot
        );
        return expandSnapshotCandidate(joined2);
      }
      const joined = import_path.default.join(normalizedRoot, ...segments);
      return [joined];
    };
    addCandidate = (list, candidate) => {
      const normalized = toAbsoluteIfPossible(candidate);
      if (!normalized) {
        return list;
      }
      if (!list.includes(normalized)) {
        list.push(normalized);
      }
      return list;
    };
    buildAssetRoots = () => {
      const roots = [];
      addCandidate(roots, EXEC_ROOT);
      addCandidate(roots, SNAPSHOT_ROOT);
      if (process.pkg?.mountpoint) {
        addCandidate(roots, process.pkg.mountpoint);
      }
      addCandidate(roots, ROOT_HINT);
      addCandidate(roots, MODULE_ROOT);
      if (!process.pkg) {
        addCandidate(roots, process.cwd());
      }
      return roots;
    };
    ASSET_ROOTS = buildAssetRoots();
      if (SNAPSHOT_ROOT) {
        try {
          const snapshotListing = import_fs.default.readdirSync(SNAPSHOT_ROOT);
          console.log("[AgentFlow][Paths][snapshot]", SNAPSHOT_ROOT, snapshotListing);
        } catch (error) {
          console.log("[AgentFlow][Paths][snapshot]", SNAPSHOT_ROOT, "unavailable:", error.message);
        }
        try {
          const parentDir = import_path.default.dirname(SNAPSHOT_ROOT);
          const rootListing = import_fs.default.readdirSync(parentDir);
          console.log("[AgentFlow][Paths][snapshot-root]", parentDir, rootListing);
        } catch (error) {
          console.log("[AgentFlow][Paths][snapshot-root]", import_path.default.dirname(SNAPSHOT_ROOT), "unavailable:", error.message);
        }
var import_url2, URLSearchParams_default;
    import_url2 = __toESM(require("url"), 1);
    URLSearchParams_default = import_url2.default.URLSearchParams;
// src/core/ProxyManager.js
function ensureDataDir() {
  const dir = import_path2.default.dirname(CONFIG_PATH);
  if (!import_fs5.default.existsSync(dir)) {
    import_fs5.default.mkdirSync(dir, { recursive: true });
  }
}
function loadSettings() {
  try {
    ensureDataDir();
    if (import_fs5.default.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(import_fs5.default.readFileSync(CONFIG_PATH, "utf-8"));
      return normalizeSettings(parsed);
  } catch (error) {
    console.warn("[ProxyManager] Failed to read settings:", error.message);
  return normalizeSettings({});
}
function normalizeSettings(raw) {
  if (!raw || typeof raw !== "object") {
    raw = {};
  }
  let proxyPayload = raw.proxy || raw;
  if (proxyPayload && typeof proxyPayload !== "object") {
    proxyPayload = {};
  }
  const proxy = {
    host: typeof proxyPayload.host === "string" ? proxyPayload.host.trim() : "",
    httpPort: Number.parseInt(proxyPayload.httpPort, 10) || null,
    socksPort: Number.parseInt(proxyPayload.socksPort, 10) || null,
    login: typeof proxyPayload.login === "string" ? proxyPayload.login.trim() : "",
    password: typeof proxyPayload.password === "string" ? proxyPayload.password.trim() : ""
  };
  const hasUserConfig = Boolean(
    raw.proxy || proxyPayload.host || proxyPayload.httpPort || proxyPayload.socksPort || proxyPayload.login || proxyPayload.password
  );
  const proxyConfig = hasUserConfig ? proxy : {
    ...DEFAULT_PROXY_CONFIG
  };
  const geminiApiKey = typeof raw.geminiApiKey === "string" && raw.geminiApiKey.trim() ? raw.geminiApiKey.trim() : process.env.GEMINI_API_KEY || "";
  applyEnvironmentVariables(proxyConfig);
  if (geminiApiKey) {
    process.env.GEMINI_API_KEY = geminiApiKey;
  }
  return { proxy: proxyConfig, geminiApiKey };
}
function saveSettings() {
  try {
    ensureDataDir();
    import_fs5.default.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ proxy: settings.proxy, geminiApiKey: settings.geminiApiKey }, null, 2),
      "utf-8"
    );
  } catch (error) {
    console.warn("[ProxyManager] Failed to persist settings:", error.message);
  }
}
function buildAuthString(config) {
  if (!config) return "";
  if (config.login && config.password) {
    return `${config.login}:${config.password}@`;
  }
  if (config.login && !config.password) {
    return `${config.login}@`;
  }
  return "";
}
function applyEnvironmentVariables(config) {
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
    httpAuthString: hasProxy ? `${buildAuthString(proxy)}${proxy.host}:${proxy.httpPort}` : ""
  };
}
var import_fs5, import_path2, import_module, CONFIG_PATH, DEFAULT_PROXY_CONFIG, settings, moduleRequire, SOCKS_MODULE_NAME, cachedSocksProxyAgent, resolveSocksProxyAgent, ProxyManager;
var init_ProxyManager = __esm({
  "src/core/ProxyManager.js"() {
    import_fs5 = __toESM(require("fs"), 1);
    import_path2 = __toESM(require("path"), 1);
    import_module = require("module");
    init_loadEnv();
    init_appPaths();
    CONFIG_PATH = resolveDataPath("agentflow_settings.json");
    DEFAULT_PROXY_CONFIG = {
      host: "102.129.221.246",
      httpPort: 7239,
      socksPort: 17239,
      login: "user332599",
      password: "hnakbz"
    };
    settings = loadSettings();
    moduleRequire = (0, import_module.createRequire)(import_path2.default.join(process.cwd(), "agentflow.require.cjs"));
    SOCKS_MODULE_NAME = process.env.AGENTFLOW_SOCKS_MODULE || "socks-proxy-agent";
    cachedSocksProxyAgent = void 0;
    resolveSocksProxyAgent = () => {
      if (cachedSocksProxyAgent !== void 0) {
        return cachedSocksProxyAgent;
      try {
        const required = moduleRequire(SOCKS_MODULE_NAME);
        const resolved = required?.SocksProxyAgent || required?.default || required;
        if (typeof resolved !== "function") {
          throw new Error("SocksProxyAgent export is not a constructor");
        cachedSocksProxyAgent = resolved;
      } catch (error) {
        cachedSocksProxyAgent = null;
        console.warn(
          `[ProxyManager] SOCKS proxy support disabled (${error.message}). Install "${SOCKS_MODULE_NAME}" to enable SOCKS5 tunnelling.`
        );
      return cachedSocksProxyAgent;
          const SocksProxyAgent = resolveSocksProxyAgent();
          if (!SocksProxyAgent) {
            return {};
          }
          const agent = new SocksProxyAgent(socksUrl);
