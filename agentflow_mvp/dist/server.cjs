    let moduleDir = null;
    try {
      moduleDir = typeof __dirname === "string" ? import_path.default.resolve(__dirname) : null;
    } catch (error) {
      moduleDir = null;
    }
    const discoverModuleRoot = () => {
      const candidates = [];
      if (moduleDir) {
        candidates.push(import_path.default.resolve(moduleDir, ".."));
        candidates.push(import_path.default.resolve(moduleDir, "..", ".."));
      }
      const cjsDir = typeof __dirname === "string" ? import_path.default.resolve(__dirname) : null;
      if (cjsDir) {
        candidates.push(import_path.default.resolve(cjsDir));
        candidates.push(import_path.default.resolve(cjsDir, ".."));
      }
      for (const candidate of candidates) {
        if (!candidate)
          continue;
        const publicDir = import_path.default.join(candidate, "public");
        const plansDir = import_path.default.join(candidate, "plans");
        if (import_fs.default.existsSync(publicDir) && import_fs.default.existsSync(plansDir)) {
          return candidate;
        }
      }
      return candidates.find(Boolean) || null;
    };
    const MODULE_ROOT = discoverModuleRoot();
    const DEFAULT_ROOT = MODULE_ROOT || import_path.default.resolve(process.cwd());
    EXEC_ROOT = process.pkg ? import_path.default.dirname(process.execPath) : ROOT_HINT ? import_path.default.resolve(ROOT_HINT) : DEFAULT_ROOT;
    SNAPSHOT_ROOT = process.pkg && process.pkg.entrypoint ? import_path.default.dirname(process.pkg.defaultEntrypoint || process.pkg.entrypoint) : MODULE_ROOT || EXEC_ROOT;
    const addCandidate = (list, candidate) => {
      if (!candidate)
        return list;
      const resolved = import_path.default.resolve(candidate);
      if (!list.some((item) => item === resolved)) {
        list.push(resolved);
      }
      return list;
    };
    const buildAssetRoots = () => {
      const roots = [];
      addCandidate(roots, EXEC_ROOT);
      addCandidate(roots, SNAPSHOT_ROOT);
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
