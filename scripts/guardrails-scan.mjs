#!/usr/bin/env node
// guardrails-scan: comprobaciones automáticas de seguridad/privacidad.
// Falla (exit 1) si detecta secretos o PII en el código fuente VERSIONADO.
// Amplíalo según docs/guardrails.md y docs/harness.md.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage", ".pnpm-store",
]);
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".sql", ".md"]);

// Patrones a vigilar (heurística; ajustar):
// `allowSyntheticInTests`: la regla admite exención SOLO en archivos de test que
// declaren el marcador de allowlist (ver PHONE_FIXTURE_MARKER). Los tests que
// prueban la PROPIA detección de PII necesitan números de ejemplo sintéticos que,
// por definición, disparan la heurística. Las reglas SIN este flag (tokens/claves,
// exposición de contacto) nunca se eximen: aplican a todo el repo, tests incluidos.
const RULES = [
  { name: "Posible token/clave en código", re: /(sk-ant-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,})/ },
  { name: "Teléfono venezolano hardcodeado", re: /\+58\s?4\d{2}[\s-]?\d{3}[\s-]?\d{4}/, allowSyntheticInTests: true },
  { name: "Campo de contacto en respuesta pública", re: /res(ponse)?\.(send|json)\([^)]*telefono/i },
];

// Marcador de allowlist para fixtures sintéticos en TESTS. Un test que valida la
// detección de teléfonos debe contener números de ejemplo (sintéticos) que disparan
// la heurística. Para que la exención sea EXPLÍCITA y AUDITABLE, el archivo de test
// declara este marcador en un comentario, con su motivo:
//   // guardrails-allow: synthetic-phone-fixtures (fixtures sintéticos para probar la detección)
// Doble candado: la exención solo aplica (1) a reglas con allowSyntheticInTests y
// (2) en archivos de test. El código de producción NUNCA queda exento.
const PHONE_FIXTURE_MARKER = "guardrails-allow: synthetic-phone-fixtures";

// Un archivo es de test si vive bajo test/ tests/ __tests__/ o su nombre termina en
// .test.* / .spec.* (ts, tsx, js, mjs, cjs). SIEMPRE se evalúa la ruta RELATIVA al
// repo (ver walk): así la exención no depende de DÓNDE esté clonado el repo — un repo
// bajo una carpeta llamada "tests/" no debe convertir todo el código en "test".
function isTestFile(relPath) {
  return /(^|[/\\])(tests?|__tests__)[/\\]/.test(relPath) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);
}

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
const exemptions = []; // trazabilidad: qué archivos usaron la exención y por qué.
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!shouldScan(entry)) continue;
    const text = readFileSync(p, "utf8");
    // Exención de fixtures sintéticos: SOLO en archivos de test (ruta RELATIVA al repo,
    // independiente de dónde esté clonado) y SOLO con el marcador explícito declarado.
    const rel = relative(ROOT, p);
    const exemptSynthetic = isTestFile(rel) && text.includes(PHONE_FIXTURE_MARKER);
    for (const rule of RULES) {
      if (!rule.re.test(text)) continue;
      // Solo se exime una regla que REALMENTE disparó: así la exención queda registrada
      // (auditable) y nunca se silencia una regla "por las dudas".
      if (rule.allowSyntheticInTests && exemptSynthetic) {
        exemptions.push(`${rel}: ${rule.name}`);
        continue;
      }
      findings.push(`${p}: ${rule.name}`);
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

// Trazabilidad: deja constancia (no bloqueante) de las exenciones aplicadas, para que
// una auditoría vea EXACTAMENTE qué fixtures sintéticos se permitieron y en qué tests.
if (exemptions.length) {
  console.log("guardrails:scan — exenciones de fixtures sintéticos (tests con marcador):");
  for (const e of exemptions) console.log("  · " + e);
}

if (findings.length) {
  console.error("guardrails:scan FALLÓ — posibles secretos/PII:");
  for (const f of findings) console.error("  - " + f);
  process.exit(1);
}
console.log("guardrails:scan OK — sin secretos/PII detectados.");
