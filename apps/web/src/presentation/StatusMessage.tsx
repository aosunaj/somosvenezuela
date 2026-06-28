import type { JSX } from "react";

interface StatusMessageProps {
  tone: "info" | "error";
  title: string;
  detail?: string;
}

// Mensaje de estado de la UI (inicial, sin resultados, error). Presentacion PURA.
// Usa role="status" para info y role="alert" para errores (accesibilidad).
export function StatusMessage({
  tone,
  title,
  detail,
}: StatusMessageProps): JSX.Element {
  const isError = tone === "error";
  const containerClass = isError
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`rounded-xl border p-6 text-center ${containerClass}`}
    >
      <p className="font-medium">{title}</p>
      {detail ? <p className="mt-1 text-sm opacity-90">{detail}</p> : null}
    </div>
  );
}
