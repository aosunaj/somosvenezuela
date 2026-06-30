import { createServiceClient, createRepos, createContactRepo } from "db";
import { buildApp } from "./app.js";
import type { AppDeps } from "./deps.js";
import { sweepExpiredConsents } from "./services/sweep.js";

// Punto de entrada del backend: cablea las dependencias REALES (cliente Supabase
// service_role + repos) y arranca el servidor Fastify.
//
// Este es el UNICO sitio que toca env y crea el cliente real. La logica de las
// rutas no conoce Supabase: recibe los repos por inyeccion (ver src/app.ts).
//
// SWEEP (judgment-r3 item 11): sweepExpiredConsents se registra via setInterval
// al arrancar. Es una tarea STANDALONE del backend, NOT del poller de Telegram.
// Intervalo configurable via SWEEP_INTERVAL_MINUTES (por defecto 5 minutos).
// Best-effort: si falla un ciclo, lo ignora y sigue en el siguiente tick.

const DEFAULT_SWEEP_INTERVAL_MINUTES = 5;

/** Lee el puerto de PORT (por defecto 3000). */
function readPort(): number {
  const raw = process.env["PORT"];
  if (raw === undefined || raw.trim().length === 0) return 3000;
  const port = Number.parseInt(raw, 10);
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`PORT invalido: ${raw}`);
  }
  return port;
}

async function main(): Promise<void> {
  // Cliente service_role (BYPASSRLS): solo vive en el backend (guardrail #1/#6).
  const client = createServiceClient();
  const repos = createRepos(client);

  const deps: AppDeps = {
    personRepo: repos.persons,
    searchRepo: repos.searches,
    petRepo: repos.pets,
    petSearchRepo: repos.petSearch,
    zoneRepo: repos.zones,
    needRepo: repos.needs,
    channelLinkRepo: repos.channelLinks,
    channelRepo: repos.channels,
    notificationRepo: repos.notifications,
    matchRepo: repos.matches,
    secureDeleteRepo: repos.secureDelete,
    personStateAuditRepo: repos.personStateAudit,
    relayRepo: repos.relay,
    auditRepo: repos.autoConnectionAudit,
    consentRepo: repos.consent,
    // SENSIBLE: solo para reveal bilateral (POST /relay/:id/reveal). El teléfono
    // solo se lee cuando AMBAS partes han dado su consentimiento explícito.
    contactRepo: createContactRepo(client),
    autoMatchThreshold: Number(process.env["AUTO_MATCH_THRESHOLD"] ?? "0.85"),
    // Secreto de servicio para operaciones privilegiadas (DELETE). Si no esta
    // definido, esas operaciones quedan deshabilitadas (responden 401).
    serviceToken: process.env["SERVICE_TOKEN"],
    // Secreto compartido bot<->backend para las rutas by-channel del Modelo B
    // (consent/respond, relay/close, rescatado). FAIL-CLOSED cuando esta presente:
    // las rutas exigen el header x-bot-secret. DEBE configurarse en Render en el
    // backend y en AMBOS bots (corte a produccion).
    botSecret: process.env["BOT_BACKEND_SECRET"],
  };

  const app = await buildApp(deps);
  const port = readPort();

  // 0.0.0.0 para que el host gestionado (Railway/Render) pueda enrutar.
  await app.listen({ port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`backend escuchando en el puerto ${port}`);

  // SWEEP: registrar tarea de barrido de consent_sessions expiradas.
  // Usa las dependencias ya cableadas (consentRepo + notificationRepo).
  // Best-effort: el .catch() garantiza que un fallo no mata el proceso.
  const rawSweepMinutes = process.env["SWEEP_INTERVAL_MINUTES"];
  const sweepMinutes =
    rawSweepMinutes !== undefined && rawSweepMinutes.trim().length > 0
      ? Number.parseInt(rawSweepMinutes, 10)
      : DEFAULT_SWEEP_INTERVAL_MINUTES;
  const sweepIntervalMs = (Number.isNaN(sweepMinutes) ? DEFAULT_SWEEP_INTERVAL_MINUTES : sweepMinutes) * 60_000;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  setInterval(async () => {
    await sweepExpiredConsents({
      notificationRepo: repos.notifications,
      getExpiredPendingConsents: () => repos.consent.getExpiredPendingConsents(),
      markConsentExpired: (id) => repos.consent.markConsentExpired(id),
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("sweep error (best-effort, ignorado):", err);
    });
  }, sweepIntervalMs);
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("No se pudo arrancar el backend:", error);
  process.exitCode = 1;
});
