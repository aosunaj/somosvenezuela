import { type JSX, useState } from "react";
import {
  SectionTabs,
  type SectionId,
  type SectionTab,
} from "../presentation/SectionTabs.tsx";
import { SearchContainer } from "./SearchContainer.tsx";
import { PetsSearchContainer } from "./PetsSearchContainer.tsx";
import { ZonesMapContainer } from "./ZonesMapContainer.tsx";

const TABS: SectionTab[] = [
  { id: "personas", label: "Buscar personas" },
  { id: "mascotas", label: "Buscar mascotas" },
  { id: "mapa", label: "Mapa de zonas" },
];

// Encabezado por seccion: titulo + descripcion calida y digna para cada vista.
const HEADINGS: Record<SectionId, { title: string; intro: string }> = {
  personas: {
    title: "Buscar a personas desaparecidas",
    intro:
      "Escribe un nombre o una descripcion y te mostramos las coincidencias.",
  },
  mascotas: {
    title: "Buscar mascotas perdidas",
    intro:
      "Tambien reunimos a las familias con sus mascotas. Escribe un nombre, un tipo o una raza.",
  },
  mapa: {
    title: "Mapa de zonas y necesidades",
    intro:
      "Explora las zonas afectadas y sus necesidades por nivel de urgencia.",
  },
};

// CONTENEDOR de navegacion: mantiene la seccion activa y renderiza la vista
// correspondiente. Cada seccion es un tabpanel accesible.
export function MainView(): JSX.Element {
  const [active, setActive] = useState<SectionId>("personas");
  const heading = HEADINGS[active];

  return (
    <div className="flex flex-col gap-6">
      <SectionTabs tabs={TABS} active={active} onChange={setActive} />

      <section
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="flex flex-col gap-6"
      >
        <div>
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
            {heading.title}
          </h2>
          <p className="mt-1 max-w-2xl text-slate-600">{heading.intro}</p>
        </div>

        {active === "personas" ? <SearchContainer /> : null}
        {active === "mascotas" ? <PetsSearchContainer /> : null}
        {active === "mapa" ? <ZonesMapContainer /> : null}
      </section>
    </div>
  );
}
