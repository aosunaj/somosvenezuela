import L from "leaflet";

// Fix conocido de Leaflet con bundlers (Vite): las rutas por defecto de las
// imagenes de los iconos de marcador se rompen porque Leaflet las resuelve por
// string y el bundler no las reescribe. Aqui evitamos el problema usando un
// DivIcon (SVG inline) coloreable, sin depender de los PNG empaquetados.
//
// Como ademas coloreamos el marcador por urgencia, el DivIcon nos da control
// total del color sin cargar imagenes externas.

/** Construye un icono de marcador (pin SVG) del color indicado. */
export function buildMarkerIcon(color: string): L.DivIcon {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="38" viewBox="0 0 26 38" aria-hidden="true">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.25 13 25 13 25s13-15.75 13-25C26 5.82 20.18 0 13 0z" fill="${color}"/>
      <circle cx="13" cy="13" r="5" fill="#ffffff"/>
    </svg>`;

  return L.divIcon({
    html: svg,
    className: "sv-zone-marker",
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    popupAnchor: [0, -34],
  });
}
