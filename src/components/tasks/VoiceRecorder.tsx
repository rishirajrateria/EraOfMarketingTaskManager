"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Upload, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { useLongPress } from "@/components/ui/useLongPress";

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

/** Deterministic pseudo-waveform tick heights (px) so pills look stable across renders. */
function ticks(seed: number, count = 26): number[] {
  return Array.from({ length: count }, (_, i) => 3 + ((Math.sin(seed * 7 + i * 1.7) + 1) / 2) * 11);
}

/**
 * The dark INPUT BAR under the description: upload ↥ (left), thin track, mic (right).
 * The mic starts/stops a voice-note recording; while recording it shows a red dot + seconds.
 */
export function VoiceInputBar({
  notes,
  onChange,
  onUpload,
  disabled,
  onError,
}: {
  notes: VoiceNote[];
  onChange: (notes: VoiceNote[]) => void;
  onUpload: () => void;
  disabled?: boolean;
  onError?: (message: string) => void;
}) {
  const r = useMediaRecorder();

  const toggle = async () => {
    if (r.recording) {
      const res = await r.stop();
      if (!res) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      onChange([...notes, { id, blob: res.blob, durationSec: res.durationSec, url: URL.createObjectURL(res.blob) }]);
    } else {
      const ok = await r.start();
      if (!ok) onError?.(r.error ?? "Recording is not supported in this browser");
    }
  };

  return (
    <div className="mx-3 my-2 flex h-11 items-center gap-2 rounded-[10px] bg-[#2B2B2B] px-3 text-white">
      <button type="button" onClick={onUpload} disabled={disabled} aria-label="Upload files" className="flex h-8 w-8 items-center justify-center rounded disabled:opacity-50">
        <Upload size={20} strokeWidth={2} aria-hidden />
      </button>
      <div className="flex h-full flex-1 items-center" aria-hidden>
        {r.recording ? (
          <span className="flex items-center gap-2 text-xs text-white">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> {r.seconds}s
          </span>
        ) : (
          <span className="h-[3px] w-full rounded-full bg-[#3A3A3A]" />
        )}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={r.recording}
        aria-label={r.recording ? "Stop recording" : "Record voice note"}
        title={r.supported ? undefined : "Recording is not supported in this browser"}
        className={clsx("flex h-8 w-8 items-center justify-center rounded disabled:opacity-50", r.recording && "text-red-400")}
      >
        {r.recording ? <Square size={18} fill="currentColor" aria-hidden /> : <Mic size={20} strokeWidth={2} aria-hidden />}
      </button>
    </div>
  );
}

/** Recorded voice notes: 170×26 dark pills with tick-mark waveform + "20s"; two per view, horizontally scrollable. */
export function VoiceNoteStrip({ notes, onChange }: { notes: VoiceNote[]; onChange: (notes: VoiceNote[]) => void }) {
  if (!notes.length) return null;
  const remove = (n: VoiceNote) => {
    URL.revokeObjectURL(n.url);
    onChange(notes.filter((x) => x.id !== n.id));
  };
  return (
    <ul className="scrollbar-none mx-3 flex gap-2 overflow-x-auto py-1" aria-label="Voice notes">
      {notes.map((n, i) => (
        <VoiceNotePill key={n.id} note={n} seed={i + 1} onRemove={() => remove(n)} />
      ))}
    </ul>
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
  const press = useLongPress(() => onRemove?.(), toggle);
  return (
    <li className="relative h-[26px] w-[170px] shrink-0 rounded-md bg-[#111]">
      <button
        type="button"
        {...press}
        aria-label={`${playing ? "Pause" : "Play"} voice note, ${note.durationSec} seconds (long-press to remove)`}
        className="flex h-full w-full items-center gap-2 pl-2 pr-6"
      >
        <span className="flex h-full flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
          {ticks(seed).map((h, i) => (
            <span key={i} className={clsx("w-px shrink-0 rounded-full", playing ? "bg-[#93C5FD]" : "bg-[#9CA3AF]")} style={{ height: `${h}px` }} />
          ))}
        </span>
        <span className="text-[10px] leading-none text-[#D1D5DB]">{note.durationSec}s</span>
      </button>
      <audio ref={audio} src={note.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label="Remove voice note" className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded text-[#9CA3AF] hover:text-white">
          <X size={10} aria-hidden />
        </button>
      ) : null}
    </li>
  );
}
