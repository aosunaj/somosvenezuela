// Runner del set dorado: corre el matcher LOCAL (sin IA) sobre los casos
// sinteticos y reporta precision/recall simples. Falla (exit 1) si baja del
// umbral acordado. Alineado con docs/harness.md ("pnpm ai:eval").
//
// Definiciones (a nivel de "el match esperado quedo primero y supera umbral"):
//   - TP: caso con match esperado y el matcher lo pone 1o con score >= umbral.
//   - FN: caso con match esperado pero el matcher NO lo identifica como tal.
//   - FP: caso NEGATIVO (sin match esperado) donde el matcher propone un match
//         fuerte (1o con score >= umbral) que no deberia existir.
//   - TN: caso negativo donde el matcher no propone match fuerte (correcto).
//
//   precision = TP / (TP + FP)
//   recall    = TP / (TP + FN)

import { rankCandidates } from "../src/index.js";
import {
  GOLDEN_CASES,
  MATCH_SCORE_THRESHOLD,
  type GoldenCase,
} from "./golden/dataset.js";

/** Umbrales de aceptacion del eval (documentados en docs/harness.md). */
const MIN_PRECISION = 0.8;
const MIN_RECALL = 0.8;

interface CaseOutcome {
  readonly id: string;
  readonly expectedMatchId: string | null;
  readonly topId: string | null;
  readonly topScore: number;
  readonly topMethod: string | null;
  /** El matcher propuso un match fuerte (1o con score >= umbral). */
  readonly proposedStrong: boolean;
  /** El caso se resolvio correctamente. */
  readonly correct: boolean;
}

async function evaluateCase(c: GoldenCase): Promise<CaseOutcome> {
  // Sin AiScorer: matching 100% local (degradacion segura, guardrail #5).
  const ranked = await rankCandidates(c.query, c.candidates);
  const top = ranked[0];
  const topId = top?.candidate.id ?? null;
  const topScore = top?.score ?? 0;
  const proposedStrong = top !== undefined && top.score >= MATCH_SCORE_THRESHOLD;

  let correct: boolean;
  if (c.expectedMatchId === null) {
    // Caso negativo: correcto si NO se propone un match fuerte.
    correct = !proposedStrong;
  } else {
    // Caso positivo: correcto si el esperado quedo 1o y supera el umbral.
    correct = proposedStrong && topId === c.expectedMatchId;
  }

  return {
    id: c.id,
    expectedMatchId: c.expectedMatchId,
    topId,
    topScore,
    topMethod: top?.method ?? null,
    proposedStrong,
    correct,
  };
}

async function main(): Promise<void> {
  const outcomes: CaseOutcome[] = [];
  for (const c of GOLDEN_CASES) {
    outcomes.push(await evaluateCase(c));
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const o of outcomes) {
    const isPositive = o.expectedMatchId !== null;
    if (isPositive) {
      if (o.correct) tp++;
      else fn++;
    } else {
      if (o.proposedStrong) fp++;
      else tn++;
    }
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);

  // Reporte por caso.
  console.log("== Eval matching (set dorado sintetico) ==\n");
  for (const o of outcomes) {
    const mark = o.correct ? "OK " : "XX ";
    const expected = o.expectedMatchId ?? "(sin match)";
    console.log(
      `${mark}${o.id}\n` +
        `   esperado=${expected}\n` +
        `   top=${o.topId ?? "(ninguno)"} score=${o.topScore.toFixed(3)} method=${o.topMethod ?? "-"}\n`,
    );
  }

  console.log("== Metricas ==");
  console.log(`casos:     ${outcomes.length}`);
  console.log(`TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
  console.log(`precision: ${precision.toFixed(3)} (umbral ${MIN_PRECISION})`);
  console.log(`recall:    ${recall.toFixed(3)} (umbral ${MIN_RECALL})`);

  const passed = precision >= MIN_PRECISION && recall >= MIN_RECALL;
  if (!passed) {
    console.error("\nEVAL FALLIDO: precision/recall por debajo del umbral.");
    process.exitCode = 1;
    return;
  }
  console.log("\nEVAL OK: umbrales de precision/recall superados.");
}

main().catch((err: unknown) => {
  console.error("Error ejecutando el eval:", err);
  process.exitCode = 1;
});
