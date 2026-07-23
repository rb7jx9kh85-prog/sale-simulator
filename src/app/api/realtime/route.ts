import { NextRequest, NextResponse } from "next/server";
import { buildProspectInstructions, DIFFICULTIES, SCENARIOS, type Difficulty, type ScenarioId } from "@/lib/sales-simulator";
import { hasValidSimulatorAccess } from "@/lib/server/simulator-access";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const maxDuration = 30;

type CallPayload = { sdp?: string; scenario?: ScenarioId; difficulty?: Difficulty };

export async function POST(request: NextRequest) {
  if (!hasValidSimulatorAccess(request.headers.get("x-sales-simulator-access-code"))) {
    return NextResponse.json({ error: "Code d'accès requis ou incorrect." }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY est absente côté serveur." }, { status: 500 });
  }

  let payload: CallPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête de session invalide." }, { status: 400 });
  }

  const validScenario = SCENARIOS.some((item) => item.id === payload.scenario);
  const validDifficulty = DIFFICULTIES.some((item) => item === payload.difficulty);
  if (!payload.sdp || !validScenario || !validDifficulty) {
    return NextResponse.json({ error: "SDP, scénario ou difficulté manquant." }, { status: 400 });
  }

  const selectedScenario = payload.scenario as ScenarioId;
  const selectedDifficulty = payload.difficulty as Difficulty;
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
  const eagerness = selectedDifficulty === "Shark Tank" || selectedDifficulty === "Dur" ? "high" : "auto";
  const session = {
    type: "realtime",
    model,
    instructions: buildProspectInstructions(selectedScenario, selectedDifficulty),
    audio: {
      input: {
        transcription: { model: "gpt-4o-transcribe", language: "fr" },
        // High eagerness makes difficult prospects take their turn sooner after a pause.
        turn_detection: { type: "semantic_vad", eagerness, create_response: true, interrupt_response: true },
      },
      output: { voice: "marin" },
    },
  };

  const form = new FormData();
  form.set("sdp", payload.sdp);
  form.set("session", JSON.stringify(session));

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      cache: "no-store",
    });

    const responseBody = await openaiResponse.text();
    if (!openaiResponse.ok) {
      console.error("Realtime session error", openaiResponse.status, responseBody);
      return NextResponse.json(
        process.env.NODE_ENV === "development"
          ? { error: "OpenAI a refusé la session Realtime.", details: responseBody }
          : { error: "OpenAI a refusé la session Realtime. Vérifie le modèle et les variables Vercel." },
        { status: openaiResponse.status },
      );
    }

    return new NextResponse(responseBody, {
      status: 200,
      headers: { "Content-Type": "application/sdp", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    console.error("Realtime session network error", error);
    return NextResponse.json({ error: "Impossible de contacter OpenAI. Vérifie ta connexion puis réessaie." }, { status: 502 });
  }
}
