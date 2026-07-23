import { NextRequest, NextResponse } from "next/server";
import type { Difficulty, ScenarioId, TranscriptTurn } from "@/lib/sales-simulator";

export const runtime = "nodejs";

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

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY est absente côté serveur." }, { status: 500 });

  let body: { transcript?: TranscriptTurn[]; scenario?: ScenarioId; difficulty?: Difficulty };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête de feedback invalide." }, { status: 400 });
  }

  if (!body.transcript?.length) {
    return NextResponse.json({ error: "La transcription est vide : impossible de produire un feedback fiable." }, { status: 400 });
  }

  const formattedTranscript = body.transcript
    .filter((turn) => turn.text.trim())
    .map((turn) => `${turn.speaker === "me" ? "NOÉ" : "PROSPECT"}: ${turn.text.trim()}`)
    .join("\n");

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
        model: process.env.OPENAI_FEEDBACK_MODEL || "gpt-4.1-mini",
        instructions,
        input: formattedTranscript,
        text: { format: { type: "json_schema", name: "sales_call_feedback", strict: true, schema } },
      }),
      cache: "no-store",
    });

    const raw = await response.text();
    if (!response.ok) {
      console.error("Feedback API error", response.status, raw);
      return NextResponse.json({ error: "OpenAI n'a pas pu générer le feedback.", details: raw }, { status: response.status });
    }

    const payload = JSON.parse(raw) as { output_text?: string };
    if (!payload.output_text) throw new Error("Réponse OpenAI sans output_text");
    return NextResponse.json(JSON.parse(payload.output_text));
  } catch (error) {
    console.error("Feedback generation error", error);
    return NextResponse.json({ error: "Le feedback n'a pas pu être généré. Réessaie dans quelques instants." }, { status: 502 });
  }
}
