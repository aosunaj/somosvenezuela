// Maquina de conversacion compartida (Telegram/WhatsApp) — barrel del modulo.
// Tipos y reducer PUROS; sin red, BD ni transporte. Los adaptadores la consumen.

export * from "./state.js";
export { step } from "./machine.js";
export {
  BUTTON,
  menuButtons,
  confirmButtons,
  skipButtons,
  searchResults,
  searchPetResults,
  registerSummary,
  registerDone,
  petSummary,
  registerPetDone,
  deleteConfirm,
} from "./messages.js";
