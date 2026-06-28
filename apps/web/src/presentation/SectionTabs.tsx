import type { JSX } from "react";

/** Identificador de cada vista principal de la web. */
export type SectionId = "personas" | "mascotas" | "mapa";

export interface SectionTab {
  id: SectionId;
  label: string;
}

interface SectionTabsProps {
  tabs: SectionTab[];
  active: SectionId;
  onChange: (id: SectionId) => void;
}

// Navegacion entre vistas (Buscar personas / Buscar mascotas / Mapa).
// Componente de presentacion PURO con roles ARIA de pestanas para accesibilidad.
export function SectionTabs({
  tabs,
  active,
  onChange,
}: SectionTabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Secciones de SomosVenezuela"
      className="flex flex-wrap gap-2"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition focus:ring-2 focus:ring-indigo-300 focus:outline-none ${
              selected
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
