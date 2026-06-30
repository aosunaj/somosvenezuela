import type {
  AuditRepo,
  ChannelLinkRepo,
  ChannelRepo,
  ConsentRepo,
  MatchRepo,
  NeedRepo,
  NotificationRepo,
  PersonRepo,
  PersonStateAuditRepo,
  PetRepo,
  PetSearchRepo,
  RelayRepo,
  SearchRepo,
  SecureDeleteRepo,
  ZoneRepo,
} from "db";

// Dependencias que necesita la API para funcionar.
//
// Se inyectan en buildApp por el contrato (no se importan dentro de los handlers)
// para poder testear la API con repos FALSOS, sin red ni Supabase. El cableado
// real (cliente service_role + repos) vive solo en src/index.ts.

/** Repositorios y configuracion que consume la capa de adaptadores (Fastify). */
export interface AppDeps {
  /** Repositorio de personas (escritura en tabla base, lectura por vista publica). */
  personRepo: PersonRepo;
  /** Repositorio de busquedas (flujo interno; nunca expone buscador_contact_id). */
  searchRepo: SearchRepo;
  /** Mascotas: alta y busqueda publica difusa. */
  petRepo: PetRepo;
  petSearchRepo: PetSearchRepo;
  /** Mapa: zonas afectadas y sus necesidades (lectura publica, alta por voluntarios). */
  zoneRepo: ZoneRepo;
  needRepo: NeedRepo;
  /** Vinculo usuario<->canal (channels/opt_in) para registro y notificacion. */
  channelLinkRepo: ChannelLinkRepo;
  /** Canales (SENSIBLE): resuelve channel_id -> (plataforma, chat_id) para entregar. */
  channelRepo: ChannelRepo;
  /** Cola de notificaciones (entrega por el canal del usuario). */
  notificationRepo: NotificationRepo;
  /** Coincidencias propuestas por el motor de matching, para revision humana. */
  matchRepo: MatchRepo;
  /** Borrado seguro por el dueno (derecho al olvido). */
  secureDeleteRepo: SecureDeleteRepo;
  /** Auditoria de cambios de estado sensibles (guardrail #8): quien + cuando. */
  personStateAuditRepo: PersonStateAuditRepo;
  /**
   * Secreto de servicio para operaciones privilegiadas (p. ej. DELETE).
   * Si esta vacio o indefinido, esas operaciones quedan deshabilitadas (responden 401).
   * En Fase 2, el borrado por el dueno via canal usara el token del bot.
   */
  serviceToken: string | undefined;
  /**
   * Relay de mensajes entre dos canales tras doble consentimiento (relay_sessions).
   * SENSIBLE: solo backend.
   */
  relayRepo: RelayRepo;
  /**
   * Auditoría inmutable de conexiones automáticas (auto_connection_audit).
   * SENSIBLE: solo backend.
   */
  auditRepo: AuditRepo;
  /**
   * Consentimiento bilateral y apertura de relay vía plpgsql.
   * SENSIBLE: solo backend.
   */
  consentRepo: ConsentRepo;
  /**
   * Umbral de score para el auto-path (por defecto 0.85 del env).
   * Por debajo → gate humano. La IA sugiere, los humanos confirman (guardrail #4).
   */
  autoMatchThreshold: number;
}
