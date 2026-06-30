import { describe, expect, it } from "vitest";
import { BUTTON } from "core";
import { handleUpdate, type UpdateDeps } from "../src/handle-update.js";
import { InMemorySessionStore } from "../src/session-store.js";
import {
  FakeBackend,
  FakeTransport,
  ownedPersonFixture,
  publicNeedFixture,
  publicPersonFixture,
  publicPetFixture,
  publicZoneFixture,
  SYNTH_CONTACT_ID,
  SYNTH_PERSON_ID,
  textUpdate,
} from "./fakes.js";

// Pruebas del adaptador de Telegram con dobles en memoria (sin red ni token).
// Verifican la orquestacion maquina<->efectos<->backend, la persistencia de
// estado por chat, el contrato de privacidad y el manejo de errores del backend.

const CHAT = 555;

/** Arma deps frescas con backend configurable. */
function makeDeps(backend: FakeBackend): {
  deps: UpdateDeps;
  transport: FakeTransport;
  sessions: InMemorySessionStore;
} {
  const transport = new FakeTransport();
  const sessions = new InMemorySessionStore();
  return { deps: { transport, backend, sessions }, transport, sessions };
}

/** Envia una secuencia de textos como updates al mismo chat. */
async function send(deps: UpdateDeps, chatId: number, ...texts: string[]): Promise<void> {
  let updateId = 1;
  for (const text of texts) {
    await handleUpdate(textUpdate(chatId, text, updateId++), deps);
  }
}

/**
 * Secuencia de textos que completa la BUSQUEDA GUIADA con solo el nombre `query`
 * (apellidos, edad, zona y senas omitidos) y responde la pregunta de menor (R2-4a)
 * con "No", disparando la busqueda. Util para los tests que solo necesitan llegar a
 * los resultados sin rellenar todos los campos.
 */
function searchByName(query: string): string[] {
  return [
    BUTTON.buscar,
    query, // nombre
    BUTTON.omitir, // apellidos
    BUTTON.omitir, // edad
    BUTTON.omitir, // zona
    BUTTON.omitir, // senas
    "No", // ¿es menor? (R2-4a) -> dispara la busqueda
  ];
}

describe("registro end-to-end", () => {
  it("recorre el flujo, pide cada dato y al confirmar llama a createPerson con los datos correctos", async () => {
    const backend = new FakeBackend();
    const { deps, transport } = makeDeps(backend);

    // Recorrido completo: menu -> registrar -> nombre -> resto omitido -> confirmar.
    await send(
      deps,
      CHAT,
      BUTTON.registrar, // inicia el flujo de registro
      "Maria Sintetica", // nombre
      BUTTON.omitir, // apellidos
      "34", // edad valida
      BUTTON.omitir, // zona
      BUTTON.omitir, // descripcion
      BUTTON.confirmar, // confirma -> dispara create_person
    );

    // El bot pidio cada dato en orden (verificamos por fragmentos de los prompts).
    const conversation = transport.allText();
    expect(conversation).toContain("nombre");
    expect(conversation).toContain("edad");
    expect(conversation).toContain("zona");
    expect(conversation).toContain("Revisa los datos antes de guardar");

    // Llamo a registerPerson exactamente una vez, con los datos correctos, SIN
    // contacto de terceros, y vinculando el canal (plataforma + chatId como cadena).
    expect(backend.registerCalls).toHaveLength(1);
    expect(backend.createCalls).toHaveLength(0); // el flujo real NO usa createPerson.
    const call = backend.registerCalls[0];
    const data = call?.person as Record<string, unknown>;
    expect(data["nombre"]).toBe("Maria Sintetica");
    expect(data["edad"]).toBe(34);
    expect(data["fuente"]).toBe("propia");
    expect("contact_id" in data).toBe(false);
    // El canal viaja al backend para vincular el registro al usuario.
    expect(call?.channel).toEqual({ plataforma: "telegram", chatId: String(CHAT) });

    // El ultimo mensaje confirma el registro e incluye el id para poder borrarlo luego.
    const conversationEnd = transport.allText();
    expect(conversationEnd).toContain("Registrado");
    expect(conversationEnd).toContain("11111111-1111-4111-8111-111111111111");
  });
});

describe("registro de mascota end-to-end", () => {
  it("recorre el flujo, recoge datos y al confirmar llama a registerPet con el canal y el id", async () => {
    const backend = new FakeBackend();
    const { deps, transport } = makeDeps(backend);

    await send(
      deps,
      CHAT,
      BUTTON.registrarMascota, // inicia el flujo de registro de mascota
      "Firulais", // nombre
      "perro", // tipo
      BUTTON.omitir, // raza
      "Zona Sur", // zona
      BUTTON.confirmar, // confirma -> dispara create_pet
    );

    // Pidio los datos de la mascota y mostro el resumen.
    const conversation = transport.allText();
    expect(conversation).toContain("Revisa los datos de la mascota");

    // Llamo a registerPet una vez con los datos correctos, SIN contacto de terceros,
    // y vinculando el canal (plataforma + chatId como cadena).
    expect(backend.registerPetCalls).toHaveLength(1);
    const call = backend.registerPetCalls[0];
    const pet = call?.pet as Record<string, unknown>;
    expect(pet["nombre"]).toBe("Firulais");
    expect(pet["tipo"]).toBe("perro");
    expect(pet["zona"]).toBe("Zona Sur");
    expect(pet["fuente"]).toBe("propia");
    expect("contact_id" in pet).toBe(false);
    expect(call?.channel).toEqual({ plataforma: "telegram", chatId: String(CHAT) });

    // Mensaje final de mascota registrada con el id para poder borrarla luego.
    expect(conversation).toContain("Registrada");
    expect(conversation).toContain("11111111-1111-4111-8111-111111111111");
  });

  it("responde un mensaje amable si registerPet lanza, sin filtrar el error", async () => {
    const backend = new FakeBackend({ failCreate: true });
    const { deps, transport } = makeDeps(backend);

    await expect(
      send(deps, CHAT, BUTTON.registrarMascota, "Michi", "gato", BUTTON.omitir, BUTTON.omitir, BUTTON.confirmar),
    ).resolves.toBeUndefined();

    expect(backend.registerPetCalls).toHaveLength(1);
    const conversation = transport.allText();
    expect(conversation).toContain("No pudimos guardar la mascota");
    expect(conversation).not.toContain("sintetico");
  });
});

describe("busqueda guiada", () => {
  it("recorre el flujo guiado y llama a searchPersons con nombre+apellidos, zona y senas", async () => {
    const backend = new FakeBackend({
      searchResults: [
        publicPersonFixture({ nombre: "Jose Sintetico", zona: "Zona Sur", score: 0.9 }),
      ],
    });
    const { deps, transport } = makeDeps(backend);

    // Busqueda guiada: nombre -> apellidos -> edad (omitida) -> zona -> senas -> menor.
    await send(
      deps,
      CHAT,
      BUTTON.buscar, // inicia el flujo de busqueda guiada
      "Jose", // nombre
      "Sintetico", // apellidos
      BUTTON.omitir, // edad
      "Zona Sur", // zona
      "chaqueta azul", // senas
      "No", // ¿es menor? (R2-4a) -> dispara la busqueda
    );

    // El backend recibio la query con nombre + apellidos juntos, la zona y las senas.
    expect(backend.searchCalls).toHaveLength(1);
    expect(backend.searchCalls[0]?.query).toBe("Jose Sintetico");
    expect(backend.searchCalls[0]?.zona).toBe("Zona Sur");
    expect(backend.searchCalls[0]?.descripcion).toBe("chaqueta azul");

    // Los resultados se mostraron con campos publicos.
    const conversation = transport.allText();
    expect(conversation).toContain("Jose Sintetico");
    expect(conversation).toContain("Zona Sur");
    // Presentacion honesta: "posible coincidencia" + parecido ponderado (no certeza).
    expect(conversation).toContain("posible coincidencia");
    expect(conversation).toContain("parecido: 90%");
  });

  it("buscar con un solo dato (resto omitido) tambien dispara la busqueda", async () => {
    const backend = new FakeBackend({ searchResults: [] });
    const { deps } = makeDeps(backend);

    await send(
      deps,
      CHAT,
      BUTTON.buscar,
      "Nadie", // nombre
      BUTTON.omitir, // apellidos
      BUTTON.omitir, // edad
      BUTTON.omitir, // zona
      BUTTON.omitir, // senas
      "No", // ¿es menor? (R2-4a) -> con solo el nombre ya busca
    );

    expect(backend.searchCalls).toHaveLength(1);
    expect(backend.searchCalls[0]?.query).toBe("Nadie");
  });

  it("muestra el mensaje de sin resultados cuando el backend no devuelve nada", async () => {
    const backend = new FakeBackend({ searchResults: [] });
    const { deps, transport } = makeDeps(backend);

    await send(
      deps,
      CHAT,
      BUTTON.buscar,
      "Nadie",
      BUTTON.omitir,
      BUTTON.omitir,
      BUTTON.omitir,
      BUTTON.omitir,
      "No", // ¿es menor? (R2-4a) -> dispara la busqueda
    );

    expect(backend.searchCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No encontramos coincidencias");
  });

  it("omitir TODO no busca con vacio: pide al menos un dato (no llama al backend)", async () => {
    const backend = new FakeBackend({ searchResults: [] });
    const { deps, transport } = makeDeps(backend);

    await send(
      deps,
      CHAT,
      BUTTON.buscar,
      BUTTON.omitir, // nombre
      BUTTON.omitir, // apellidos
      BUTTON.omitir, // edad
      BUTTON.omitir, // zona
      BUTTON.omitir, // senas -> todo vacio
    );

    // No se busca con vacio: el backend NO se llama y se pide al menos un dato.
    expect(backend.searchCalls).toHaveLength(0);
    expect(transport.allText()).toContain("al menos un dato");
  });
});

describe("busqueda de mascotas", () => {
  it("llama a searchPets con la query y envia los resultados publicos", async () => {
    const backend = new FakeBackend({
      petResults: [
        publicPetFixture({ nombre: "Firulais", tipo: "perro", zona: "Zona Sur", score: 0.8 }),
      ],
    });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.buscarMascota, "Firulais");

    // El backend recibio la query por el canal de mascotas (no por el de personas).
    expect(backend.petSearchCalls).toHaveLength(1);
    expect(backend.petSearchCalls[0]?.query).toBe("Firulais");
    expect(backend.searchCalls).toHaveLength(0);

    const conversation = transport.allText();
    expect(conversation).toContain("Firulais");
    expect(conversation).toContain("Zona Sur");
    // Presentacion honesta: "posible coincidencia" + parecido ponderado (no certeza).
    expect(conversation).toContain("posible coincidencia");
    expect(conversation).toContain("parecido: 80%");
  });

  it("muestra el mensaje de sin resultados cuando no hay coincidencias", async () => {
    const backend = new FakeBackend({ petResults: [] });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.buscarMascota, "Nadie");

    expect(backend.petSearchCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No encontramos mascotas");
  });

  it("responde amable y vuelve a idle si searchPets lanza", async () => {
    const backend = new FakeBackend({ failSearchPets: true });
    const { deps, transport, sessions } = makeDeps(backend);

    await expect(send(deps, CHAT, BUTTON.buscarMascota, "Algo")).resolves.toBeUndefined();

    expect(backend.petSearchCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No pudimos completar la busqueda");
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });

  it("nunca filtra contact_id aunque el backend devuelva una mascota contaminada", async () => {
    const backend = new FakeBackend({
      petResults: [
        publicPetFixture({ nombre: "Mascota Filtrada", contact_id: SYNTH_CONTACT_ID }),
      ],
    });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.buscarMascota, "Mascota");

    const conversation = transport.allText();
    expect(conversation).not.toContain(SYNTH_CONTACT_ID);
    expect(conversation).not.toContain("contact_id");
    expect(conversation).toContain("Mascota Filtrada");
  });
});

describe("puntos de encuentro (zonas)", () => {
  it("al elegir 'Puntos de encuentro' llama a listZones y muestra el listado", async () => {
    const backend = new FakeBackend({
      zoneResults: [publicZoneFixture({ nombre: "Plaza Bolivar", estado: "activa" })],
    });
    const { deps, transport, sessions } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.zonas);

    expect(backend.listZonesCalls).toBe(1);
    const conversation = transport.allText();
    expect(conversation).toContain("Plaza Bolivar");
    expect(conversation).toContain("activa");
    // Tras mostrar el listado, el flujo vuelve a idle.
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });

  it("muestra el mensaje vacio cuando no hay zonas todavia", async () => {
    const backend = new FakeBackend({ zoneResults: [] });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.zonas);

    expect(backend.listZonesCalls).toBe(1);
    expect(transport.allText()).toContain("Todavia no hay puntos de encuentro");
  });

  it("responde amable y vuelve a idle si listZones lanza", async () => {
    const backend = new FakeBackend({ failListZones: true });
    const { deps, transport, sessions } = makeDeps(backend);

    await expect(send(deps, CHAT, BUTTON.zonas)).resolves.toBeUndefined();

    expect(backend.listZonesCalls).toBe(1);
    expect(transport.allText()).toContain("No pudimos completar la busqueda");
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });
});

describe("necesidades", () => {
  it("al elegir 'Necesidades' llama a listNeeds y muestra el listado ordenado", async () => {
    const backend = new FakeBackend({
      needResults: [
        publicNeedFixture({ tipo: "agua", urgencia: "baja", descripcion: "detalle agua" }),
        publicNeedFixture({ tipo: "medicinas", urgencia: "critica", descripcion: "detalle medicinas" }),
      ],
    });
    const { deps, transport, sessions } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.necesidades);

    expect(backend.listNeedsCalls).toBe(1);
    const conversation = transport.allText();
    expect(conversation).toContain("medicinas");
    expect(conversation).toContain("[critica]");
    // La mas urgente sale antes que la menos urgente.
    expect(conversation.indexOf("medicinas")).toBeLessThan(conversation.indexOf("agua"));
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });

  it("muestra el mensaje vacio cuando no hay necesidades", async () => {
    const backend = new FakeBackend({ needResults: [] });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.necesidades);

    expect(backend.listNeedsCalls).toBe(1);
    expect(transport.allText()).toContain("no hay necesidades publicadas");
  });

  it("responde amable y vuelve a idle si listNeeds lanza", async () => {
    const backend = new FakeBackend({ failListNeeds: true });
    const { deps, transport, sessions } = makeDeps(backend);

    await expect(send(deps, CHAT, BUTTON.necesidades)).resolves.toBeUndefined();

    expect(backend.listNeedsCalls).toBe(1);
    expect(transport.allText()).toContain("No pudimos completar la busqueda");
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });
});

describe("persistencia de estado por chat", () => {
  it("mantiene el flujo entre updates del mismo chatId", async () => {
    const backend = new FakeBackend();
    const { deps, sessions } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.registrar);
    // Tras iniciar registro, el estado quedo en el paso 'nombre'.
    expect(sessions.get(CHAT)).toEqual({ flow: "register", step: "nombre", draft: {} });

    await send(deps, CHAT, "Ana Sintetica");
    // El siguiente update avanzo al paso 'apellidos' conservando el nombre.
    expect(sessions.get(CHAT)).toEqual({
      flow: "register",
      step: "apellidos",
      draft: { nombre: "Ana Sintetica" },
    });
  });

  it("no mezcla el estado de chats distintos", async () => {
    const backend = new FakeBackend();
    const { deps, sessions } = makeDeps(backend);

    const chatA = 100;
    const chatB = 200;

    // chatA inicia registro; chatB inicia busqueda.
    await send(deps, chatA, BUTTON.registrar);
    await send(deps, chatB, BUTTON.buscar);

    const stateA = sessions.get(chatA);
    const stateB = sessions.get(chatB);
    expect(stateA?.flow).toBe("register");
    expect(stateB?.flow).toBe("search");
  });
});

describe("privacidad: nunca sale dato de contacto", () => {
  // Telefono sintetico SIN formato venezolano real, para no disparar el escaner
  // de guardrails (que prohibe telefonos +58... versionados). Igual prueba que el
  // adaptador no filtra el campo `telefono` aunque el backend lo cuele.
  const SYNTH_PHONE = "000-000-0000";

  it("no incluye contact_id ni telefono aunque el backend devuelva resultados contaminados", async () => {
    // Backend malicioso/defectuoso: cuela contact_id y telefono en el resultado.
    const backend = new FakeBackend({
      searchResults: [
        publicPersonFixture({
          nombre: "Persona Filtrada",
          contact_id: SYNTH_CONTACT_ID,
          telefono: SYNTH_PHONE,
        }),
      ],
    });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, ...searchByName("Persona"));

    // Ningun mensaje enviado contiene el contacto contaminante.
    const conversation = transport.allText();
    expect(conversation).not.toContain(SYNTH_CONTACT_ID);
    expect(conversation).not.toContain("contact_id");
    expect(conversation).not.toContain("telefono");
    expect(conversation).not.toContain(SYNTH_PHONE);
    // Pero el dato publico SI se mostro (la busqueda funciono).
    expect(conversation).toContain("Persona Filtrada");
  });
});

describe("manejo de errores del backend", () => {
  it("responde un mensaje amable y no crashea si createPerson lanza", async () => {
    const backend = new FakeBackend({ failCreate: true });
    const { deps, transport } = makeDeps(backend);

    // No debe lanzar pese a que el backend falla al crear.
    await expect(
      send(
        deps,
        CHAT,
        BUTTON.registrar,
        "Pedro Sintetico",
        BUTTON.omitir,
        BUTTON.omitir,
        BUTTON.omitir,
        BUTTON.omitir,
        BUTTON.confirmar,
      ),
    ).resolves.toBeUndefined();

    expect(backend.registerCalls).toHaveLength(1);
    // La maquina vuelve a ofrecer confirmar con un mensaje amable (sin detalles internos).
    const conversation = transport.allText();
    expect(conversation).toContain("No pudimos guardar el registro");
    expect(conversation).not.toContain("sintetico"); // no filtra el mensaje del Error
  });

  it("responde un mensaje amable y no crashea si searchPersons lanza", async () => {
    const backend = new FakeBackend({ failSearch: true });
    const { deps, transport, sessions } = makeDeps(backend);

    await expect(send(deps, CHAT, ...searchByName("Algo"))).resolves.toBeUndefined();

    expect(backend.searchCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No pudimos completar la busqueda");
    // Tras el fallo, la conversacion vuelve a idle (no queda atascada en 'searching').
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });
});

describe("borrado seguro por canal (elige de TUS registros, sin pegar codigos)", () => {
  const SYNTH_ID = "11111111-1111-4111-8111-111111111111";

  it("lista mis registros, elijo el 1 y confirmo: llama a deleteByChannel con id y canal", async () => {
    const backend = new FakeBackend({ myPersonsResults: [ownedPersonFixture()] });
    const { deps, transport, sessions } = makeDeps(backend);

    // BUTTON.borrar -> lista mis registros (por canal); "1" -> elige; confirmar -> borra.
    await send(deps, CHAT, BUTTON.borrar, "1", BUTTON.confirmar);

    // Listo mis registros con la identidad del canal (chatId como cadena).
    expect(backend.listMyPersonsCalls).toHaveLength(1);
    expect(backend.listMyPersonsCalls[0]?.channel).toEqual({
      plataforma: "telegram",
      chatId: String(CHAT),
    });
    // Y borro el registro elegido con su id y el canal.
    expect(backend.deleteCalls).toHaveLength(1);
    expect(backend.deleteCalls[0]?.personId).toBe(SYNTH_ID);
    expect(backend.deleteCalls[0]?.channel).toEqual({
      plataforma: "telegram",
      chatId: String(CHAT),
    });

    // La maquina confirma el borrado y vuelve a idle.
    expect(transport.allText()).toContain("Registro borrado");
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });

  it("sin registros propios avisa y no llama a borrado", async () => {
    const backend = new FakeBackend({ myPersonsResults: [] });
    const { deps, transport, sessions } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.borrar);

    expect(backend.listMyPersonsCalls).toHaveLength(1);
    expect(backend.deleteCalls).toHaveLength(0);
    expect(transport.allText()).toContain("No encontramos registros");
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });

  it("ante un 403 (no es el dueno) responde el fallo amable sin revelar la causa", async () => {
    const backend = new FakeBackend({ myPersonsResults: [ownedPersonFixture()], deleteNotOwner: true });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.borrar, "1", BUTTON.confirmar);

    expect(backend.deleteCalls).toHaveLength(1);
    // Mensaje generico de la maquina (no confirma existencia ni pertenencia a un tercero).
    const conversation = transport.allText();
    expect(conversation).toContain("No pudimos borrar el registro");
    expect(conversation).not.toContain("403");
    expect(conversation).not.toContain("dueno");
  });

  it("no crashea si el borrado falla por un error transitorio del backend", async () => {
    const backend = new FakeBackend({ myPersonsResults: [ownedPersonFixture()], failDelete: true });
    const { deps, transport } = makeDeps(backend);

    await expect(
      send(deps, CHAT, BUTTON.borrar, "1", BUTTON.confirmar),
    ).resolves.toBeUndefined();

    expect(backend.deleteCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No pudimos borrar el registro");
  });
});

describe("rescatado seguro por canal (elige de TUS registros, sin pegar codigos)", () => {
  const SYNTH_ID = "11111111-1111-4111-8111-111111111111";

  it("lista mis registros, elijo el 1 y confirmo: llama a markFoundByChannel con id y canal", async () => {
    const backend = new FakeBackend({ myPersonsResults: [ownedPersonFixture()] });
    const { deps, transport, sessions } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.rescatado, "1", BUTTON.confirmar);

    expect(backend.listMyPersonsCalls).toHaveLength(1);
    expect(backend.markFoundCalls).toHaveLength(1);
    expect(backend.markFoundCalls[0]?.personId).toBe(SYNTH_ID);
    expect(backend.markFoundCalls[0]?.channel).toEqual({
      plataforma: "telegram",
      chatId: String(CHAT),
    });

    // La maquina confirma el marcado y vuelve a idle.
    expect(transport.allText()).toContain("encontrado con vida");
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });

  it("sin registros propios avisa y no llama a marcado", async () => {
    const backend = new FakeBackend({ myPersonsResults: [] });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.rescatado);

    expect(backend.listMyPersonsCalls).toHaveLength(1);
    expect(backend.markFoundCalls).toHaveLength(0);
    expect(transport.allText()).toContain("No encontramos registros");
  });

  it("ante un 403 (no es el dueno) responde el fallo amable sin revelar la causa", async () => {
    const backend = new FakeBackend({ myPersonsResults: [ownedPersonFixture()], markFoundNotOwner: true });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.rescatado, "1", BUTTON.confirmar);

    expect(backend.markFoundCalls).toHaveLength(1);
    // Mensaje generico de la maquina (no confirma existencia ni pertenencia a un tercero).
    const conversation = transport.allText();
    expect(conversation).toContain("No pudimos marcar el registro");
    expect(conversation).not.toContain("403");
    expect(conversation).not.toContain("dueno");
  });

  it("no crashea si el marcado falla por un error transitorio del backend", async () => {
    const backend = new FakeBackend({ myPersonsResults: [ownedPersonFixture()], failMarkFound: true });
    const { deps, transport } = makeDeps(backend);

    await expect(
      send(deps, CHAT, BUTTON.rescatado, "1", BUTTON.confirmar),
    ).resolves.toBeUndefined();

    expect(backend.markFoundCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No pudimos marcar el registro");
  });
});

describe("reencuentro: el buscador elige a quien conectar", () => {
  it("tras buscar, elegir el numero llama a requestReunion con el id y el canal (sin contacto)", async () => {
    const backend = new FakeBackend({
      searchResults: [publicPersonFixture({ nombre: "Jose Sintetico", score: 0.9 })],
      reunionRequestStatus: "requested",
    });
    const { deps, transport } = makeDeps(backend);

    // Busca (flujo guiado), ve resultados, y elige el 1 para conectar.
    await send(deps, CHAT, ...searchByName("Jose"), "1");

    // Llamo a requestReunion con el id publico de la persona elegida y el canal.
    expect(backend.requestReunionCalls).toHaveLength(1);
    expect(backend.requestReunionCalls[0]?.personId).toBe(SYNTH_PERSON_ID);
    expect(backend.requestReunionCalls[0]?.channel).toEqual({
      plataforma: "telegram",
      chatId: String(CHAT),
    });
    // Confirmacion calida al buscador; NUNCA aparece contacto de la otra parte.
    const conversation = transport.allText();
    expect(conversation).toContain("permiso");
    expect(conversation).not.toContain("telefono");
    expect(conversation).not.toContain("contact_id");
  });

  it("status 'minor' muestra el aviso de proteccion de menores (guardrail #2)", async () => {
    const backend = new FakeBackend({
      searchResults: [publicPersonFixture({ nombre: "Menor Sintetico" })],
      reunionRequestStatus: "minor",
    });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, ...searchByName("Menor"), "1");

    expect(backend.requestReunionCalls).toHaveLength(1);
    expect(transport.allText().toLowerCase()).toContain("entidad verificada");
  });

  it("si requestReunion lanza, responde 'failed' sin crashear ni filtrar el error", async () => {
    const backend = new FakeBackend({
      searchResults: [publicPersonFixture({ nombre: "Jose Sintetico" })],
      failRequestReunion: true,
    });
    const { deps, transport } = makeDeps(backend);

    await expect(send(deps, CHAT, ...searchByName("Jose"), "1")).resolves.toBeUndefined();

    expect(backend.requestReunionCalls).toHaveLength(1);
    const conversation = transport.allText();
    expect(conversation).toContain("No pudimos iniciar la conexion");
    expect(conversation).not.toContain("sintetico");
  });

  it("un numero fuera de rango re-pide sin llamar a requestReunion (no expulsa)", async () => {
    const backend = new FakeBackend({
      searchResults: [publicPersonFixture({ nombre: "Jose Sintetico" })],
    });
    const { deps, transport, sessions } = makeDeps(backend);

    await send(deps, CHAT, ...searchByName("Jose"), "9");

    expect(backend.requestReunionCalls).toHaveLength(0);
    // Se queda en 'choosing' y re-pide con botones (antes el numero malo expulsaba).
    expect((sessions.get(CHAT) as { step?: string } | undefined)?.step).toBe("choosing");
    expect(transport.allText().toLowerCase()).toContain("no entendi");
  });

  it("el boton 'No, volver al inicio' sale sin conectar", async () => {
    const backend = new FakeBackend({
      searchResults: [publicPersonFixture({ nombre: "Jose Sintetico" })],
    });
    const { deps, sessions } = makeDeps(backend);

    await send(deps, CHAT, ...searchByName("Jose"), BUTTON.noConectar);

    expect(backend.requestReunionCalls).toHaveLength(0);
    expect(sessions.get(CHAT)).toEqual({ flow: "idle" });
  });
});

describe("reencuentro: el registrante responde por comando global", () => {
  it("/conectar va directo al backend con el canal (sin pasar por la sesion)", async () => {
    const backend = new FakeBackend({ reunionConsentStatus: "accepted_waiting" });
    const { deps, transport, sessions } = makeDeps(backend);

    await send(deps, CHAT, "/conectar");

    expect(backend.reunionConsentCalls).toHaveLength(1);
    expect(backend.reunionConsentCalls[0]?.decision).toBe("aceptado");
    expect(backend.reunionConsentCalls[0]?.channel).toEqual({
      plataforma: "telegram",
      chatId: String(CHAT),
    });
    // No deja estado de sesion (es un comando global, fuera de la maquina).
    expect(sessions.get(CHAT)).toBeUndefined();
    expect(transport.allText()).toContain("Gracias");
  });

  it("/conectar con doble si (exchanged) avisa que llega el contacto en un momento", async () => {
    const backend = new FakeBackend({ reunionConsentStatus: "exchanged" });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, "/conectar");

    expect(backend.reunionConsentCalls[0]?.decision).toBe("aceptado");
    expect(transport.allText()).toContain("te enviaremos el contacto");
  });

  it("/rechazar manda decision 'rechazado' y confirma que no se comparte el contacto", async () => {
    const backend = new FakeBackend({ reunionConsentStatus: "rejected" });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, "/rechazar");

    expect(backend.reunionConsentCalls).toHaveLength(1);
    expect(backend.reunionConsentCalls[0]?.decision).toBe("rechazado");
    expect(transport.allText()).toContain("No compartiremos tu contacto");
  });

  it("/conectar sin solicitud pendiente (not_found) responde el mensaje neutro", async () => {
    const backend = new FakeBackend({ reunionConsentStatus: "not_found" });
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, "/conectar");

    expect(transport.allText()).toContain("ninguna solicitud de conexion pendiente");
  });

  it("si reunionConsent lanza, responde un mensaje generico sin crashear", async () => {
    const backend = new FakeBackend({ failReunionConsent: true });
    const { deps, transport } = makeDeps(backend);

    await expect(send(deps, CHAT, "/conectar")).resolves.toBeUndefined();

    expect(backend.reunionConsentCalls).toHaveLength(1);
    expect(transport.allText()).toContain("No pudimos registrar tu respuesta");
  });
});

describe("comandos y updates raros", () => {
  it("normaliza /start y muestra el menu", async () => {
    const backend = new FakeBackend();
    const { deps, transport } = makeDeps(backend);

    await send(deps, CHAT, "/start");
    expect(transport.allText()).toContain("SomosVenezuela");
  });

  it("ignora sin crashear updates sin mensaje o con forma invalida", async () => {
    const backend = new FakeBackend();
    const { deps, transport } = makeDeps(backend);

    // Sin `message` y con forma totalmente invalida: no hay chat a quien responder,
    // se ignoran en silencio.
    await handleUpdate({ update_id: 1 }, deps);
    await handleUpdate({ basura: true }, deps);

    expect(transport.sent).toHaveLength(0);
  });
});

describe("fotos y contenido sin texto", () => {
  it("usa el caption de una foto como texto: no pierde lo que la persona escribe al pie", async () => {
    const backend = new FakeBackend();
    const { deps, sessions } = makeDeps(backend);

    await send(deps, CHAT, BUTTON.registrar); // entra al paso 'nombre'
    // La persona manda una FOTO con el nombre al pie (caption), no como texto plano.
    await handleUpdate(
      { update_id: 50, message: { chat: { id: CHAT }, caption: "Maria Sintetica" } },
      deps,
    );

    // El caption se consumio como respuesta: el flujo avanzo y guardo el nombre.
    expect(sessions.get(CHAT)).toEqual({
      flow: "register",
      step: "apellidos",
      draft: { nombre: "Maria Sintetica" },
    });
  });

  it("guia en vez de quedar en silencio cuando llega contenido sin texto (foto sola, sticker)", async () => {
    const backend = new FakeBackend();
    const { deps, transport } = makeDeps(backend);

    // Mensaje real de un chat pero sin texto ni caption (foto sola / sticker / ubicacion).
    await handleUpdate({ update_id: 60, message: { chat: { id: CHAT } } }, deps);

    // No se descarta en silencio: respondemos una guia para que no quede colgada.
    expect(transport.sent).toHaveLength(1);
    expect(transport.allText()).toContain("solo puedo leer mensajes de texto");
  });
});
