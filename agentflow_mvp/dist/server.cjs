    var HttpsProxyAgent2 = class extends agent_base_1.Agent {
    HttpsProxyAgent2.protocols = ["http", "https"];
    exports2.HttpsProxyAgent = HttpsProxyAgent2;
        const HttpsProxyAgent2 = await __classPrivateFieldGet(_a, _a, "m", _Gaxios_getProxyAgent).call(_a);
          opts.agent = new HttpsProxyAgent2(proxy, {
function normalizeScheme(value) {
  if (!value || typeof value !== "string") {
    return DEFAULT_PROXY_CONFIG.httpScheme;
  }
  const lower = value.toLowerCase();
  if (ALLOWED_HTTP_SCHEMES.has(lower)) {
    return lower;
  }
  return DEFAULT_PROXY_CONFIG.httpScheme;
}
    httpScheme: normalizeScheme(proxyPayload.httpScheme || proxyPayload.scheme),
function encodeCredential(value) {
  return encodeURIComponent(value);
}
function buildAuthString(config, { encode: encode3 = true } = {}) {
    if (encode3) {
      return `${encodeCredential(config.login)}:${encodeCredential(config.password)}@`;
    }
    return encode3 ? `${encodeCredential(config.login)}@` : `${config.login}@`;
function buildProxyUrl(config) {
  const auth = buildAuthString(config, { encode: true });
  const scheme = config.httpScheme || DEFAULT_PROXY_CONFIG.httpScheme;
  return `${scheme}://${auth}${config.host}:${config.httpPort}`;
}
    const httpUrl = buildProxyUrl(config);
    httpAuthString: hasProxy ? `${proxy.httpScheme || DEFAULT_PROXY_CONFIG.httpScheme}://${buildAuthString(proxy, { encode: false })}${proxy.host}:${proxy.httpPort}` : ""
var import_fs5, import_path2, import_socks_proxy_agent, import_https_proxy_agent, CONFIG_PATH, ALLOWED_HTTP_SCHEMES, DEFAULT_PROXY_CONFIG, settings, ProxyManager;
    import_https_proxy_agent = __toESM(require_dist4(), 1);
    ALLOWED_HTTP_SCHEMES = /* @__PURE__ */ new Set(["http", "https"]);
      host: "",
      httpPort: null,
      httpScheme: "http",
      socksPort: null,
      login: "",
      password: ""
          httpScheme: normalizeScheme(merged.httpScheme || merged.scheme || settings.proxy.httpScheme),
          if (config.httpScheme === "https") {
            const httpUrl = buildProxyUrl(config);
            const agent = new import_https_proxy_agent.HttpsProxyAgent(httpUrl);
            return {
              httpAgent: agent,
              httpsAgent: agent,
              proxy: false
            };
          }
          const proxyConfig = {
            protocol: config.httpScheme || DEFAULT_PROXY_CONFIG.httpScheme,
            port: config.httpPort
            proxyConfig.auth = {
          return { proxy: proxyConfig };
            httpsAgent: agent,
            proxy: false
