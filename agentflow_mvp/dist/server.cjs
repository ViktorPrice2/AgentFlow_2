function ensureDataDir(targetPath) {
  const dir = import_path2.default.dirname(targetPath);
    const configPath = pickConfigPath();
    ensureDataDir(configPath);
    if (import_fs5.default.existsSync(configPath)) {
      const parsed = JSON.parse(import_fs5.default.readFileSync(configPath, "utf-8"));
function pickConfigPath() {
  if (import_fs5.default.existsSync(PRIMARY_CONFIG_PATH)) {
    return PRIMARY_CONFIG_PATH;
  }
  return LEGACY_CONFIG_PATH;
}
  const proxyConfig = sanitizeProxyConfig(proxy);
    const targetPath = PRIMARY_CONFIG_PATH;
    ensureDataDir(targetPath);
      targetPath,
    if (LEGACY_CONFIG_PATH !== targetPath && import_fs5.default.existsSync(LEGACY_CONFIG_PATH)) {
      try {
        import_fs5.default.unlinkSync(LEGACY_CONFIG_PATH);
      } catch (unlinkError) {
        console.warn("[ProxyManager] Failed to remove legacy settings file:", unlinkError.message);
      }
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
    host: config.host || "",
    httpPort: Number.isFinite(config.httpPort) ? config.httpPort : null,
    socksPort: Number.isFinite(config.socksPort) ? config.socksPort : null,
    login: config.login || "",
    password: config.password || ""
  };
  if (!baseConfig.host) {
    return { ...baseConfig, httpPort: null, socksPort: null, login: "", password: "" };
  }
  if (isLegacyDefaultProxy(baseConfig)) {
    return { host: "", httpPort: null, socksPort: null, login: "", password: "" };
  }
  return baseConfig;
}
var import_fs5, import_path2, import_socks_proxy_agent, import_https_proxy_agent, PRIMARY_CONFIG_PATH, LEGACY_CONFIG_PATH, LEGACY_DEFAULT_PROXY, settings, ProxyManager;
    PRIMARY_CONFIG_PATH = resolveDataPath("settings.json");
    LEGACY_CONFIG_PATH = resolveDataPath("agentflow_settings.json");
    LEGACY_DEFAULT_PROXY = {
        settings.proxy = sanitizeProxyConfig(normalized);
