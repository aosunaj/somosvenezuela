import type { FastifyInstance } from "fastify";

// Liveness simple: confirma que el proceso responde. No toca la BD.

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => {
    return { status: "ok" };
  });
}
