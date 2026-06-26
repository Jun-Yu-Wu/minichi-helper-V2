const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnv(rootDir = process.cwd()) {
  for (const file of [".env.local", ".env"]) {
    const fullPath = path.join(rootDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}

module.exports = {
  loadLocalEnv,
};
