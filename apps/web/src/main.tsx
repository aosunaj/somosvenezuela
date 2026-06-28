import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

// Punto de entrada del navegador: monta la app de busqueda publica en #root.
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("No se encontro el elemento #root para montar la aplicacion.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
