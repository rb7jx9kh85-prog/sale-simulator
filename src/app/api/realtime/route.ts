import { NextRequest, NextResponse } from "next/server";
import { buildProspectInstructions, type Difficulty, type ScenarioId } from "@/lib/sales-simulator";

export const runtime = "nodejs";

type CallPayload = { sdp?: string; scenario?: ScenarioId; difficulty?: Difficulty };

export async function POST(request: NextRequest) {
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

  if (!payload.sdp || !payload.scenario || !payload.difficulty) {
    return NextResponse.json({ error: "SDP, scénario ou difficulté manquant." }, { status: 400 });
  }

  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
  const session = {
    type: "realtime",
    model,
    instructions: buildProspectInstructions(payload.scenario, payload.difficulty),
    audio: {
      input: {
        transcription: { model: "gpt-4o-transcribe", language: "fr" },
        turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
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
        "OpenAI-Safety-Identifier": "alpinia-sales-simulator",
      },
      body: form,
      cache: "no-store",
    });

    const responseBody = await openaiResponse.text();
    if (!openaiResponse.ok) {
      console.error("Realtime session error", openaiResponse.status, responseBody);
      return NextResponse.json({ error: "OpenAI a refusé la session Realtime.", details: responseBody }, { status: openaiResponse.status });
    }

    return new NextResponse(responseBody, {
      status: 200,
      headers: { "Content-Type": "application/sdp", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Realtime session network error", error);
    return NextResponse.json({ error: "Impossible de contacter OpenAI. Vérifie ta connexion puis réessaie." }, { status: 502 });
  }
}
