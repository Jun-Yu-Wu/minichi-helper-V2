const fs = require("node:fs");
const path = require("node:path");

function envFiles(rootDir) {
  const explicitFile = String(process.env.MINICHI_ENV_FILE || "").trim();
  if (!explicitFile) return [".env.local", ".env"];
  if (path.basename(explicitFile) !== explicitFile) {
    throw new Error("MINICHI_ENV_FILE must be a file name inside the application root.");
  }
  const fullPath = path.join(rootDir, explicitFile);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`MINICHI_ENV_FILE does not exist: ${explicitFile}`);
  }
  return [explicitFile];
}

function loadLocalEnv(rootDir = process.cwd()) {
  for (const file of envFiles(rootDir)) {
    const fullPath = path.join(rootDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      let line = lines[index];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      let rawValue = trimmed.slice(equalsIndex + 1).trim();
      const quote = rawValue[0];
      if ((quote === '"' || quote === "'") && !rawValue.endsWith(quote)) {
        const valueLines = [rawValue];
        while (index + 1 < lines.length) {
          index += 1;
          valueLines.push(lines[index]);
          if (lines[index].trimEnd().endsWith(quote)) break;
        }
        rawValue = valueLines.join("\n");
      }
      if (process.env[key]) continue;
      process.env[key] = rawValue
        .replace(/^['"]|['"]$/g, "")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r");
    }
  }
}

module.exports = {
  envFiles,
  loadLocalEnv,
};
