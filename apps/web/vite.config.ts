import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { PluginOption } from "vite";
import { defineConfig } from "vitest/config";

// Configuracion de Vite para la web publica de busqueda.
// - plugin React (JSX, Fast Refresh) + plugin de Tailwind 4.
// - Vitest con entorno jsdom para testear componentes en un DOM simulado.
export default defineConfig({
  // Cast por desajuste de versiones de tipos de Vite entre vitest/config y los plugins.
  plugins: [react(), tailwindcss()] as unknown as PluginOption[],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
