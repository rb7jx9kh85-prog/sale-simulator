"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, ChevronRight, Mic, MicOff, Phone, PhoneOff, Sparkles, Volume2 } from "lucide-react";
import { DIFFICULTIES, SCENARIOS, type Difficulty, type Feedback, type ScenarioId, type TranscriptTurn } from "@/lib/sales-simulator";

type CallStatus = "ready" | "connecting" | "in-call" | "finished" | "error";

const STATUS_COPY: Record<CallStatus, string> = {
  ready: "Prêt",
  connecting: "Connexion…",
  "in-call": "En appel",
  finished: "Terminé",
  error: "Erreur",
};

function EventBubble({ turn }: { turn: TranscriptTurn }) {
  const isMe = turn.speaker === "me";
  return (
    <div className={`turn ${isMe ? "turn-me" : "turn-prospect"}`}>
      <span>{isMe ? "Moi" : "Prospect IA"}</span>
      <p>{turn.text}</p>
    </div>
  );
}

export function SalesSimulatorClient() {
  const [scenario, setScenario] = useState<ScenarioId>("restaurant");
  const [difficulty, setDifficulty] = useState<Difficulty>("Normal");
  const [accessCode, setAccessCode] = useState("");
  const [status, setStatus] = useState<CallStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<TranscriptTurn[]>([]);
  const liveProspectIdRef = useRef<string | null>(null);
  const pendingUserTurnsRef = useRef(0);

  const updateTranscript = useCallback((updater: (previous: TranscriptTurn[]) => TranscriptTurn[]) => {
    setTranscript((previous) => {
      const next = updater(previous);
      transcriptRef.current = next;
      return next;
    });
  }, []);

  const cleanUp = useCallback(() => {
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }
    liveProspectIdRef.current = null;
    pendingUserTurnsRef.current = 0;
    setIsMuted(false);
  }, []);

  useEffect(() => cleanUp, [cleanUp]);

  const addCompletedTurn = useCallback((speaker: TranscriptTurn["speaker"], text: unknown, id?: string) => {
    if (typeof text !== "string" || !text.trim()) return;
    const turnId = id || crypto.randomUUID();
    updateTranscript((previous) => {
      const existing = previous.findIndex((turn) => turn.id === turnId);
      const next = { id: turnId, speaker, text: text.trim() } as TranscriptTurn;
      if (existing === -1) return [...previous, next];
      return previous.map((turn, index) => (index === existing ? next : turn));
    });
  }, [updateTranscript]);

  const handleRealtimeEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type;
    if (process.env.NODE_ENV === "development") console.debug("[realtime]", event);

    if (type === "input_audio_buffer.speech_stopped") {
      pendingUserTurnsRef.current += 1;
      return;
    }

    if (type === "response.created") {
      if (pendingUserTurnsRef.current > 0) {
        pendingUserTurnsRef.current -= 1;
        return;
      }

      // Semantic VAD should create one response per completed speech turn.
      // Cancel any orphan response before it can repeat the prospect's answer.
      const response = event.response;
      const responseId = response && typeof response === "object" && typeof (response as { id?: unknown }).id === "string"
        ? (response as { id: string }).id
        : undefined;
      if (responseId && channelRef.current?.readyState === "open") {
        channelRef.current.send(JSON.stringify({ type: "response.cancel", response_id: responseId }));
      }
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      addCompletedTurn("me", event.transcript, typeof event.item_id === "string" ? event.item_id : undefined);
      return;
    }

    if (type === "response.output_audio_transcript.delta") {
      const id = typeof event.item_id === "string" ? event.item_id : "prospect-live";
      liveProspectIdRef.current = id;
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!delta) return;
      updateTranscript((previous) => {
        const existing = previous.find((turn) => turn.id === id);
        if (existing) return previous.map((turn) => turn.id === id ? { ...turn, text: turn.text + delta } : turn);
        return [...previous, { id, speaker: "prospect", text: delta }];
      });
      return;
    }

    if (type === "response.output_audio_transcript.done") {
      const id = typeof event.item_id === "string" ? event.item_id : liveProspectIdRef.current || undefined;
      addCompletedTurn("prospect", event.transcript, id);
      liveProspectIdRef.current = null;
    }
  }, [addCompletedTurn, updateTranscript]);

  const toggleMute = useCallback(() => {
    const audioTracks = streamRef.current?.getAudioTracks() ?? [];
    if (!audioTracks.length) return;
    const nextMuted = !isMuted;
    audioTracks.forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  }, [isMuted]);

  const startCall = async () => {
    setError(null);
    setFeedback(null);
    setTranscript([]);
    transcriptRef.current = [];
    pendingUserTurnsRef.current = 0;
    setIsMuted(false);
    setStatus("connecting");

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Ton navigateur ne permet pas l'accès au microphone.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      const remoteAudio = document.createElement("audio");
      remoteAudio.autoplay = true;
      remoteAudio.setAttribute("playsinline", "true");
      audioRef.current = remoteAudio;
      peer.ontrack = ({ streams }) => {
        remoteAudio.srcObject = streams[0];
        void remoteAudio.play().catch((playError) => console.warn("Audio autoplay blocked", playError));
      };
      peer.onconnectionstatechange = () => {
        if (process.env.NODE_ENV === "development") console.debug("[webrtc]", peer.connectionState);
        if (peer.connectionState === "failed") {
          setError("La connexion audio a échoué. Réessaie l'appel.");
          setStatus("error");
          cleanUp();
        }
      };

      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.onmessage = ({ data }) => {
        try { handleRealtimeEvent(JSON.parse(data)); } catch { console.warn("Realtime event non JSON", data); }
      };
      channel.onerror = () => console.warn("Data channel error");

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("/api/realtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessCode ? { "x-sales-simulator-access-code": accessCode } : {}),
        },
        body: JSON.stringify({ sdp: offer.sdp, scenario, difficulty }),
      });
      const answerSdp = await response.text();
      if (!response.ok) {
        let detail = "";
        try { detail = JSON.parse(answerSdp).error || ""; } catch { /* API response already unusable */ }
        throw new Error(detail || "Impossible de créer la session OpenAI Realtime.");
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      setStatus("in-call");
    } catch (caught) {
      console.error("Unable to start call", caught);
      const message = caught instanceof DOMException && caught.name === "NotAllowedError"
        ? "Micro refusé. Autorise le microphone dans ton navigateur puis réessaie."
        : caught instanceof Error ? caught.message : "Impossible de démarrer l'appel.";
      setError(message);
      setStatus("error");
      cleanUp();
    }
  };

  const finishCall = async () => {
    cleanUp();
    setStatus("finished");
    const turns = transcriptRef.current.filter((turn) => turn.text.trim());
    if (!turns.length) {
      setError("Aucune transcription reçue : parle quelques secondes avant de terminer pour obtenir le feedback.");
      return;
    }
    setFeedbackLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessCode ? { "x-sales-simulator-access-code": accessCode } : {}),
        },
        body: JSON.stringify({ transcript: turns, scenario, difficulty }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Impossible de générer le feedback.");
      setFeedback(data as Feedback);
    } catch (caught) {
      console.error("Unable to create feedback", caught);
      setError(caught instanceof Error ? caught.message : "Impossible de générer le feedback.");
    } finally {
      setFeedbackLoading(false);
    }
  };

  const active = status === "in-call" || status === "connecting";
  return (
    <main className="app-shell">
      <section className="hero">
        <div className="brand"><span className="brand-mark">A</span> ALPINIA WEB CRAFT</div>
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={15} /> ENTRAÎNEMENT LIVE</div>
          <h1>Alpinia <em>Sales Simulator</em></h1>
          <p>Entraîne-toi au cold call avec des prospects suisses réalistes.</p>
        </div>
        <div className={`status-pill status-${status}`}><span /> {STATUS_COPY[status]}</div>
      </section>

      <section className="simulator-grid">
        <aside className="panel control-panel">
          <div className="panel-heading"><div><p className="section-kicker">Configuration</p><h2>Ton appel</h2></div><Activity size={20} /></div>
          <label htmlFor="scenario">Scénario prospect</label>
          <select id="scenario" value={scenario} onChange={(event) => setScenario(event.target.value as ScenarioId)} disabled={active}>
            {SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <label>Niveau de difficulté</label>
          <div className="difficulty-grid">
            {DIFFICULTIES.map((item) => <button key={item} type="button" className={difficulty === item ? "selected" : ""} onClick={() => setDifficulty(item)} disabled={active}>{item}</button>)}
          </div>
          <label htmlFor="access-code">Code d&apos;accès <small>(si activé sur Vercel)</small></label>
          <input id="access-code" type="password" autoComplete="off" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} disabled={active} placeholder="Optionnel" />
          <div className="scenario-note"><span>PROSPECT SÉLECTIONNÉ</span><strong>{SCENARIOS.find((item) => item.id === scenario)?.label}</strong><p>{difficulty} · Marc, restaurateur valaisan</p></div>
          {!active ? <button className="primary-call" onClick={startCall}><Phone size={18} /> Démarrer l&apos;appel</button> : <div className="call-controls">
            <button className={`mute-call ${isMuted ? "is-muted" : ""}`} type="button" onClick={toggleMute} disabled={status !== "in-call"} aria-pressed={isMuted}>
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />} {isMuted ? "Réactiver le micro" : "Couper le micro"}
            </button>
            <button className="end-call" type="button" onClick={finishCall}><PhoneOff size={18} /> Terminer</button>
          </div>}
          <p className="micro-note"><Mic size={14} /> Le micro sera demandé au démarrage.</p>
        </aside>

        <section className="panel conversation-panel">
          <div className="panel-heading"><div><p className="section-kicker">Conversation</p><h2>Transcription live</h2></div><Volume2 size={20} /></div>
          <div className="call-visual">
            <div className={`orb ${status === "in-call" ? "orb-active" : ""}`}><span>AI</span></div>
            <div><strong>{status === "in-call" ? (isMuted ? "Micro coupé" : "Marc est en ligne") : "Prêt pour la simulation"}</strong><p>{status === "in-call" ? (isMuted ? "Le prospect ne reçoit plus le son de ton micro." : "Parle naturellement, Marc peut répondre et t'interrompre.") : "Choisis un scénario puis démarre l'appel."}</p></div>
          </div>
          <div className="transcript" aria-live="polite">
            {!transcript.length && <div className="empty-state"><Mic size={24} /><p>La transcription de ton échange apparaîtra ici.</p></div>}
            {transcript.map((turn) => <EventBubble key={turn.id} turn={turn} />)}
          </div>
          {active && <div className="live-footer"><span className={`pulse ${isMuted ? "pulse-muted" : ""}`} /> {isMuted ? "Micro coupé — Marc ne t'entend pas" : "Appel live sécurisé via WebRTC"}</div>}
        </section>
      </section>

      {error && <div className="notice error-notice"><AlertCircle size={19} /> <span>{error}</span></div>}

      {(feedbackLoading || feedback) && <section className="feedback-panel panel">
        <div className="panel-heading"><div><p className="section-kicker">Débriefing</p><h2>Feedback commercial</h2></div>{feedback ? <div className="score-ring">{feedback.score}<small>/100</small></div> : <div className="loader" />}</div>
        {feedbackLoading && <div className="feedback-loading"><Sparkles size={22} /><p>Analyse de ton appel en cours…</p></div>}
        {feedback && <div className="feedback-content">
          <div className="feedback-columns">
            <article><h3><CheckCircle2 size={17} /> Ce que tu as bien fait</h3><ul>{feedback.strengths.map((item) => <li key={item}>{item}</li>)}</ul></article>
            <article><h3><AlertCircle size={17} /> Tes 3 plus grosses erreurs</h3><ol>{feedback.biggestMistakes.map((item) => <li key={item}>{item}</li>)}</ol></article>
          </div>
          <div className="phrase-box"><h3>Phrases que tu aurais pu dire</h3>{feedback.exactPhrases.map((item) => <p key={item}>“{item}”</p>)}</div>
          <div className="improvements"><article><span>TRANSITION AMÉLIORÉE</span><p>{feedback.improvedTransition}</p></article><article><span>CLOSING AMÉLIORÉ</span><p>{feedback.improvedClosing}</p></article></div>
          <div className="scorecard"><h3>Scorecard</h3>{feedback.scorecard.map((item) => <div key={item.criterion} className="score-row"><span>{item.criterion}</span><div className="score-bar"><i style={{ width: `${item.score * 10}%` }} /></div><strong>{item.score}/10</strong><small>{item.note}</small></div>)}</div>
          <div className="next-tip"><ChevronRight size={18} /><p><strong>Prochain appel :</strong> {feedback.nextCallTip}</p></div>
        </div>}
      </section>}
    </main>
  );
}
