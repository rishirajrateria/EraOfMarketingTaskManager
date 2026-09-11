"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { useToast } from "@/components/ui/Toast";
import { useMediaRecorder } from "@/components/tasks/VoiceRecorder";

/* Minimal Web Speech API typings — lib.dom only ships the result types. */
type RecognitionEvent = { resultIndex: number; results: SpeechRecognitionResultList };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;

function speechCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Mic button that appends recognised speech to the description (SPEC §6 "mic → voice-to-text").
 * Uses the Web Speech API when present; otherwise records a clip and posts it to /api/stt.
 */
export function DictationButton({
  onText,
  lang = "en-IN",
  className,
  compact,
}: {
  onText: (text: string) => void;
  lang?: string;
  className?: string;
  /** Icon-only 12px mic for the dark description toolbar. */
  compact?: boolean;
}) {
  const toast = useToast();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const fallback = useMediaRecorder();

  useEffect(() => setSupported(!!speechCtor()), []);
  useEffect(() => () => rec.current?.stop(), []);

  const stopNative = useCallback(() => {
    rec.current?.stop();
    rec.current = null;
    setListening(false);
  }, []);

  const startNative = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res?.isFinal) text += res[0]?.transcript ?? "";
      }
      if (text.trim()) onText(text.trim());
    };
    r.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") toast(`Dictation error: ${e.error}`, "err");
      stopNative();
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, [lang, onText, stopNative, toast]);

  const toggleFallback = useCallback(async () => {
    if (!fallback.recording) {
      const ok = await fallback.start();
      if (!ok && fallback.error) toast(fallback.error, "err");
      return;
    }
    const clip = await fallback.stop();
    if (!clip) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", new File([clip.blob], "dictation.webm", { type: clip.blob.type || "audio/webm" }));
      form.append("lang", lang);
      const res = await fetch("/api/stt", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        toast(res.status === 501 ? "Voice-to-text is not configured on this server" : (json.error ?? "Transcription failed"), "err");
        return;
      }
      if (json.text?.trim()) onText(json.text.trim());
      else toast("Nothing recognised", "err");
    } catch {
      toast("Transcription failed", "err");
    } finally {
      setBusy(false);
    }
  }, [fallback, lang, onText, toast]);

  const active = supported ? listening : fallback.recording;
  const onClick = supported ? (listening ? stopNative : startNative) : toggleFallback;
  const label = active ? (supported ? "Listening…" : `Recording ${fallback.seconds}s`) : busy ? "Transcribing…" : "Dictate";

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy || supported === null}
        aria-pressed={active}
        aria-label={label}
        title={supported === false ? "Web Speech API unavailable — records a clip and sends it to /api/stt" : "Dictate into the description"}
        className={clsx("flex h-6 w-6 items-center justify-center rounded disabled:opacity-50", active ? "animate-pulse text-red-400" : "text-[#9CA3AF] hover:text-white", className)}
      >
        <Mic size={12} strokeWidth={2.5} aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || supported === null}
      aria-pressed={active}
      aria-label={label}
      title={supported === false ? "Web Speech API unavailable — records a clip and sends it to /api/stt" : "Dictate into the description"}
      className={clsx(
        "touch-target flex items-center gap-1 rounded-full px-3 text-xs font-semibold disabled:opacity-50",
        active ? "animate-pulse bg-red-600 text-white" : "bg-gray-100 text-gray-700",
        className,
      )}
    >
      <span aria-hidden>🎤</span>
      <span>{label}</span>
    </button>
  );
}
