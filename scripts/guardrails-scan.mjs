#!/usr/bin/env node
// guardrails-scan: comprobaciones automáticas de seguridad/privacidad.
// Falla (exit 1) si detecta secretos o PII en el código fuente VERSIONADO.
// Amplíalo según docs/guardrails.md y docs/harness.md.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage", ".pnpm-store",
]);
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".sql", ".md"]);

// Patrones a vigilar (heurística; ajustar):
const RULES = [
  { name: "Posible token/clave en código", re: /(sk-ant-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,})/ },
  { name: "Teléfono venezolano hardcodeado", re: /\+58\s?4\d{2}[\s-]?\d{3}[\s-]?\d{4}/ },
  { name: "Campo de contacto en respuesta pública", re: /res(ponse)?\.(send|json)\([^)]*telefono/i },
];

// Decide si se escanea el CONTENIDO de un archivo.
// IMPORTANTE: el .env real (y .env.local, .env.production, ...) está en .gitignore y
// es el lugar LEGÍTIMO de los secretos: NO se escana su contenido (daría falsos
// positivos como la service_role). En cambio `.env.example` SÍ se escanea: se commitea
// y nunca debe llevar valores reales.
function shouldScan(entry) {
  if (entry === ".env.example") return true;
  if (entry === ".env" || entry.startsWith(".env.")) return false;
  return EXT.has(extname(entry));
}

const findings = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!shouldScan(entry)) continue;
    const text = readFileSync(p, "utf8");
    for (const rule of RULES) {
      if (rule.re.test(text)) findings.push(`${p}: ${rule.name}`);
    }
  }
}

// La protección real sobre el .env no es escanear su contenido (debe tener secretos),
// sino garantizar que NUNCA se pueda commitear: verifica que .gitignore lo excluya.
function checkEnvIgnored() {
  if (!existsSync(join(ROOT, ".env"))) return;
  const giPath = join(ROOT, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  const ignora = gi.split(/\r?\n/).map((l) => l.trim()).some(
    (t) => t === ".env" || t === ".env*" || t === ".env.*" || t === "/.env",
  );
  if (!ignora) {
    findings.push(".env: existe pero NO está en .gitignore (riesgo de commitear secretos)");
  }
}

try { walk(ROOT); checkEnvIgnored(); } catch (e) { console.error(e); process.exit(2); }

if (findings.length) {
  console.error("guardrails:scan FALLÓ — posibles secretos/PII:");
  for (const f of findings) console.error("  - " + f);
  process.exit(1);
}
console.log("guardrails:scan OK — sin secretos/PII detectados.");
