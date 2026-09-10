"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";

export type VoiceNote = { id: string; blob: Blob; durationSec: number; url: string };

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export function recorderSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * MediaRecorder → webm/opus blob with a live seconds counter.
 * Shared by the voice-note recorder and the dictation fallback.
 */
export function useMediaRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!recorderSupported()) {
      setError("Recording is not supported in this browser");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.start(250);
      rec.current = r;
      startedAt.current = Date.now();
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
      return true;
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Microphone permission denied" : "Could not start recording");
      return false;
    }
  }, []);

  /** Stops and resolves with the recorded blob (null if nothing was recorded). */
  const stop = useCallback((): Promise<{ blob: Blob; durationSec: number } | null> => {
    const r = rec.current;
    if (!r) return Promise.resolve(null);
    const durationSec = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    return new Promise((resolve) => {
      r.onstop = () => {
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        cleanup();
        resolve(blob.size ? { blob, durationSec } : null);
      };
      if (r.state !== "inactive") r.stop();
      else r.onstop(new Event("stop"));
    });
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);
  return { recording, seconds, error, start, stop, supported: recorderSupported() };
}

/** Deterministic pseudo-waveform bar heights (px) so pills look stable across renders. */
function bars(seed: number, count = 18): number[] {
  return Array.from({ length: count }, (_, i) => 4 + ((Math.sin(seed * 7 + i * 1.7) + 1) / 2) * 14);
}

/** Recorded voice notes rendered as "20s" waveform pills with inline playback (SPEC §6). */
export function VoiceRecorder({ notes, onChange, disabled }: { notes: VoiceNote[]; onChange: (notes: VoiceNote[]) => void; disabled?: boolean }) {
  const r = useMediaRecorder();

  const toggle = async () => {
    if (r.recording) {
      const res = await r.stop();
      if (!res) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      onChange([...notes, { id, blob: res.blob, durationSec: res.durationSec, url: URL.createObjectURL(res.blob) }]);
    } else {
      await r.start();
    }
  };

  const remove = (n: VoiceNote) => {
    URL.revokeObjectURL(n.url);
    onChange(notes.filter((x) => x.id !== n.id));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={disabled || !r.supported}
          aria-label={r.recording ? "Stop recording" : "Record voice note"}
          className={clsx(
            "touch-target flex items-center gap-2 rounded-full px-4 text-sm font-semibold text-white disabled:opacity-50",
            r.recording ? "animate-pulse bg-red-600" : "bg-brand-blue",
          )}
        >
          <span aria-hidden>{r.recording ? "■" : "🎙"}</span>
          {r.recording ? `Stop · ${r.seconds}s` : "Record voice note"}
        </button>
        {!r.supported ? <span className="text-[11px] text-gray-400">Not supported in this browser</span> : null}
        {r.error ? <span className="text-[11px] text-red-600">{r.error}</span> : null}
      </div>
      {notes.length ? (
        <ul className="flex flex-wrap gap-2">
          {notes.map((n, i) => (
            <VoiceNotePill key={n.id} note={n} seed={i + 1} onRemove={() => remove(n)} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function VoiceNotePill({ note, seed, onRemove }: { note: VoiceNote; seed: number; onRemove?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play();
  };
  return (
    <li className="flex items-center gap-1 rounded-full bg-brand-blue/10 py-1 pl-1 pr-2 text-brand-blue">
      <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play voice note"} className="touch-target flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-blue text-xs text-white">{playing ? "❚❚" : "▶"}</span>
        <span className="waveform flex h-5 items-center" aria-hidden>
          {bars(seed).map((h, i) => (
            <span key={i} style={{ height: `${h}px` }} />
          ))}
        </span>
        <span className="text-xs font-semibold">{note.durationSec}s</span>
      </button>
      <audio ref={audio} src={note.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label="Remove voice note" className="touch-target text-gray-400">
          ✕
        </button>
      ) : null}
    </li>
  );
}
