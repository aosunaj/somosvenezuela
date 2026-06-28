import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZonesMapContainer } from "../containers/ZonesMapContainer.tsx";
import type { Need, Zone } from "../api/zones.ts";

// ESTRATEGIA DE TEST DEL MAPA
// ---------------------------------------------------------------------------
// Leaflet manipula el DOM directamente y NO renderiza en jsdom (no hay layout,
// ni tiles, ni tamano de contenedor). Por eso mockeamos por completo el modulo
// "leaflet": cada constructor devuelve un doble encadenable que solo registra
// las llamadas que nos importan (marker.on("click", ...)). Asi probamos la
// LOGICA del contenedor (cargar zonas, seleccionar zona, cargar necesidades,
// pintar urgencias) sin depender del render real del mapa.
//
// Las llamadas de Leaflet se capturan para poder simular el click en un marcador.
const markerClickHandlers = new Map<string, () => void>();

vi.mock("leaflet", () => {
  // Doble de marcador: guarda el handler de click por titulo de zona.
  function makeMarker(_latlng: unknown, opts: { title?: string }) {
    const title = opts.title ?? "";
    const marker = {
      bindPopup: () => marker,
      on: (event: string, handler: () => void) => {
        if (event === "click") {
          markerClickHandlers.set(title, handler);
        }
        return marker;
      },
      addTo: () => marker,
      openPopup: () => marker,
      remove: () => marker,
    };
    return marker;
  }

  const mapDouble = {
    setView: () => mapDouble,
    fitBounds: () => mapDouble,
    remove: () => undefined,
  };

  const tileLayerDouble = { addTo: () => tileLayerDouble };

  const L = {
    map: () => mapDouble,
    tileLayer: () => tileLayerDouble,
    marker: makeMarker,
    divIcon: () => ({}),
    latLngBounds: () => ({}),
  };

  return { default: L };
});

// Datos SINTETICOS (sin PII real).
const zonaCaracas: Zone = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  nombre: "Caracas Centro",
  lat: 10.5,
  lng: -66.9,
  estado: "evacuada",
  updated_at: "2026-06-21T08:00:00.000Z",
};

const zonaValencia: Zone = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  nombre: "Valencia Norte",
  lat: 10.18,
  lng: -68.0,
  estado: null,
  updated_at: "2026-06-21T08:00:00.000Z",
};

const necesidadesCaracas: Need[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    zone_id: zonaCaracas.id,
    tipo: "Agua potable",
    urgencia: "critica",
    descripcion: "Hace falta agua para 200 familias.",
    updated_at: "2026-06-21T09:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    zone_id: zonaCaracas.id,
    tipo: "Mantas",
    urgencia: "media",
    descripcion: null,
    updated_at: "2026-06-21T09:00:00.000Z",
  },
];

/**
 * Mockea fetch enrutando por URL: /zones devuelve las zonas dadas y
 * /needs devuelve las necesidades dadas.
 */
function mockFetchRouting(zones: Zone[], needs: Need[]): void {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    const body = url.includes("/needs") ? { needs } : { zones };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.restoreAllMocks();
  markerClickHandlers.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ZonesMapContainer", () => {
  it("carga las zonas al montar y pide GET /zones", async () => {
    mockFetchRouting([zonaCaracas, zonaValencia], []);

    render(<ZonesMapContainer />);

    // Mientras carga, muestra el estado de carga.
    expect(screen.getByText(/cargando el mapa de zonas/i)).toBeInTheDocument();

    // Tras cargar, el panel pide seleccionar una zona.
    expect(
      await screen.findByText(/selecciona una zona en el mapa/i),
    ).toBeInTheDocument();

    const fetchMock = vi.mocked(fetch);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("http://localhost:3000/zones");
  });

  it("al seleccionar una zona pide sus necesidades y las renderiza con su urgencia", async () => {
    mockFetchRouting([zonaCaracas, zonaValencia], necesidadesCaracas);

    render(<ZonesMapContainer />);
    await screen.findByText(/selecciona una zona en el mapa/i);

    // Simulo el click en el marcador de Caracas (capturado por el mock de Leaflet).
    const handler = markerClickHandlers.get("Caracas Centro");
    expect(handler).toBeTypeOf("function");
    handler?.();

    // El panel muestra la zona y sus necesidades con la urgencia.
    expect(await screen.findByText("Caracas Centro")).toBeInTheDocument();
    expect(screen.getByText(/Agua potable/i)).toBeInTheDocument();
    expect(screen.getByText(/Critica/i)).toBeInTheDocument();
    expect(screen.getByText(/Mantas/i)).toBeInTheDocument();

    // Pidio /needs con el zoneId correcto.
    const fetchMock = vi.mocked(fetch);
    const needsCall = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes("/needs"));
    expect(needsCall).toContain("zoneId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("muestra un error amable si las zonas no cargan", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    render(<ZonesMapContainer />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no pudimos cargar el mapa de zonas/i,
    );
  });

  it("muestra un estado vacio cuando no hay zonas", async () => {
    mockFetchRouting([], []);

    render(<ZonesMapContainer />);

    expect(
      await screen.findByText(/todavia no hay zonas registradas/i),
    ).toBeInTheDocument();
  });

  it("avisa cuando una necesidad falla al cargar", async () => {
    const fetchMock = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes("/needs")) {
        return Promise.reject(new Error("needs down"));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ zones: [zonaCaracas] }),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ZonesMapContainer />);
    await screen.findByText(/selecciona una zona en el mapa/i);

    markerClickHandlers.get("Caracas Centro")?.();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no pudimos cargar las necesidades/i,
    );
  });
});
