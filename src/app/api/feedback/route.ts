import { NextRequest, NextResponse } from "next/server";
import { DIFFICULTIES, SCENARIOS, type Difficulty, type ScenarioId, type TranscriptTurn } from "@/lib/sales-simulator";
import { hasValidSimulatorAccess } from "@/lib/server/simulator-access";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const maxDuration = 60;

const SCORECARD = [
  "Ouverture / pattern interrupt",
  "Tonalité et confiance",
  "Recueil d'informations",
  "Qualification du prospect",
  "Transition vers la présentation",
  "Présentation des bénéfices",
  "Certitude produit",
  "Certitude entreprise",
  "Certitude vendeur",
  "Gestion des objections",
  "Closing",
  "Fluidité globale",
];

type FeedbackResult = {
  score: number;
  strengths: string[];
  biggestMistakes: string[];
  exactPhrases: string[];
  improvedTransition: string;
  improvedClosing: string;
  nextCallTip: string;
  scorecard: Array<{ criterion: string; score: number; note: string }>;
};

function readOutputText(response: unknown) {
  if (!response || typeof response !== "object") return null;
  const payload = response as { output_text?: unknown; output?: unknown };
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  if (!Array.isArray(payload.output)) return null;

  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return null;
}

function isFeedbackResult(value: unknown): value is FeedbackResult {
  if (!value || typeof value !== "object") return false;
  const feedback = value as Partial<FeedbackResult>;
  return typeof feedback.score === "number"
    && Array.isArray(feedback.strengths)
    && Array.isArray(feedback.biggestMistakes)
    && Array.isArray(feedback.exactPhrases)
    && typeof feedback.improvedTransition === "string"
    && typeof feedback.improvedClosing === "string"
    && typeof feedback.nextCallTip === "string"
    && Array.isArray(feedback.scorecard)
    && feedback.scorecard.length === SCORECARD.length;
}

export async function POST(request: NextRequest) {
  if (!hasValidSimulatorAccess(request.headers.get("x-sales-simulator-access-code"))) {
    return NextResponse.json({ error: "Code d'accès requis ou incorrect." }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY est absente côté serveur." }, { status: 500 });

  let body: { transcript?: TranscriptTurn[]; scenario?: ScenarioId; difficulty?: Difficulty };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête de feedback invalide." }, { status: 400 });
  }

  const validScenario = SCENARIOS.some((item) => item.id === body.scenario);
  const validDifficulty = DIFFICULTIES.some((item) => item === body.difficulty);
  if (!body.transcript?.length || body.transcript.length > 120 || !validScenario || !validDifficulty) {
    return NextResponse.json({ error: "La transcription est vide : impossible de produire un feedback fiable." }, { status: 400 });
  }

  const formattedTranscript = body.transcript
    .filter((turn) => (turn.speaker === "me" || turn.speaker === "prospect") && typeof turn.text === "string" && turn.text.trim())
    .map((turn) => `${turn.speaker === "me" ? "NOÉ" : "PROSPECT"}: ${turn.text.trim().slice(0, 2_000)}`)
    .join("\n");

  if (!formattedTranscript) {
    return NextResponse.json({ error: "La transcription n'est pas exploitable." }, { status: 400 });
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      score: { type: "integer", minimum: 0, maximum: 100 },
      strengths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      biggestMistakes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
      exactPhrases: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      improvedTransition: { type: "string" },
      improvedClosing: { type: "string" },
      nextCallTip: { type: "string" },
      scorecard: {
        type: "array",
        minItems: 12,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            criterion: { type: "string" },
            score: { type: "integer", minimum: 0, maximum: 10 },
            note: { type: "string" },
          },
          required: ["criterion", "score", "note"],
        },
      },
    },
    required: ["score", "strengths", "biggestMistakes", "exactPhrases", "improvedTransition", "improvedClosing", "nextCallTip", "scorecard"],
  };

  const instructions = `Tu es un coach de vente senior, exigeant, bienveillant et spécialiste de la Straight Line Persuasion. Analyse l'appel ci-dessous entre Noé (Alpinia Web Craft) et un prospect suisse romand. Le scénario est ${body.scenario}, difficulté ${body.difficulty}.

Donne un coaching concret, en français, sans inventer ce que Noé n'a pas dit. Note précisément les 12 critères dans cet ordre : ${SCORECARD.join("; ")}. Pour les trois certitudes, donne un score distinct pour le produit, l'entreprise et le vendeur. Les phrases exactes proposées doivent être naturelles, utilisables par Noé, adaptées à une agence web suisse et ne pas manipuler. Le score final doit refléter l'ensemble de l'appel, même s'il est court.`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_FEEDBACK_MODEL || "gpt-4o-mini",
        instructions,
        input: formattedTranscript,
        text: { format: { type: "json_schema", name: "sales_call_feedback", strict: true, schema } },
      }),
      cache: "no-store",
    });

    const raw = await response.text();
    if (!response.ok) {
      console.error("Feedback API error", response.status, raw);
      return NextResponse.json(
        process.env.NODE_ENV === "development"
          ? { error: "OpenAI n'a pas pu générer le feedback.", details: raw }
          : { error: "OpenAI n'a pas pu générer le feedback. Réessaie dans quelques instants." },
        { status: response.status },
      );
    }

    const outputText = readOutputText(JSON.parse(raw));
    if (!outputText) throw new Error("Réponse OpenAI sans texte exploitable");
    const feedback = JSON.parse(outputText);
    if (!isFeedbackResult(feedback)) throw new Error("Réponse OpenAI de feedback incomplète");
    return NextResponse.json(feedback);
  } catch (error) {
    console.error("Feedback generation error", error);
    const reason = error instanceof Error ? error.message : "erreur inconnue";
    return NextResponse.json(
      process.env.NODE_ENV === "development"
        ? { error: "Le feedback n'a pas pu être généré.", details: reason }
        : { error: "Le feedback n'a pas pu être généré. Vérifie OPENAI_FEEDBACK_MODEL et les logs de la fonction /api/feedback sur Vercel." },
      { status: 502 },
    );
  }
}
