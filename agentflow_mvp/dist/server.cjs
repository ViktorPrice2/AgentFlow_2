function loadViewEngine(mod) {
  switch (mod) {
    case "ejs":
      return require("ejs");
    case "pug":
      return require("pug");
    default:
      return null;
  }
}

        var engineModule = loadViewEngine(mod);
        var fn = engineModule && engineModule.__express;
