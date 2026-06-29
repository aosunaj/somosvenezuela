import { createServiceClient, createRepos } from "db";
import { buildApp } from "./app.js";
import type { AppDeps } from "./deps.js";

// Punto de entrada del backend: cablea las dependencias REALES (cliente Supabase
// service_role + repos) y arranca el servidor Fastify.
//
// Este es el UNICO sitio que toca env y crea el cliente real. La logica de las
// rutas no conoce Supabase: recibe los repos por inyeccion (ver src/app.ts).

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
    // Secreto de servicio para operaciones privilegiadas (DELETE). Si no esta
    // definido, esas operaciones quedan deshabilitadas (responden 401).
    serviceToken: process.env["SERVICE_TOKEN"],
  };

  const app = await buildApp(deps);
  const port = readPort();

  // 0.0.0.0 para que el host gestionado (Railway/Render) pueda enrutar.
  await app.listen({ port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`backend escuchando en el puerto ${port}`);
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("No se pudo arrancar el backend:", error);
  process.exitCode = 1;
});
