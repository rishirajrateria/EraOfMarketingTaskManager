"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";
import { ChipButton } from "@/components/ui/Controls";
import { fmtSecs } from "@/components/tasks/add-task-helpers";

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

/** Filled mic glyph from the prototype. */
function MicGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </svg>
  );
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Voice note (prototype `micToggle`): a big round mic — tap to record, tap again to stop. While recording it turns
 * red with a pulse and a live m:ss timer; each note becomes a chip with its duration, ▶ and ✕. The notes are uploaded
 * as VOICE_NOTE attachments after the task is created (AddTaskSheet → uploadAttachment).
 */
export function VoiceNoteRecorder({
  notes,
  onChange,
  disabled,
  onError,
  onAttached,
}: {
  notes: VoiceNote[];
  onChange: (notes: VoiceNote[]) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
  onAttached?: () => void;
}) {
  const r = useMediaRecorder();

  const toggle = async () => {
    if (r.recording) {
      const res = await r.stop();
      if (!res) return;
      onChange([...notes, { id: newId(), blob: res.blob, durationSec: res.durationSec, url: URL.createObjectURL(res.blob) }]);
      onAttached?.();
      return;
    }
    const ok = await r.start();
    if (!ok) onError?.(r.error ?? "Recording is not supported in this browser");
  };

  const remove = (n: VoiceNote) => {
    URL.revokeObjectURL(n.url);
    onChange(notes.filter((x) => x.id !== n.id));
  };

  return (
    <div className="mt-4 flex items-center gap-3.5">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={r.recording}
        aria-label={r.recording ? "Stop recording" : "Record a voice note"}
        title={r.supported ? undefined : "Recording is not supported in this browser"}
        className={clsx("mic-btn flex h-[60px] w-[60px] shrink-0 touch-none items-center justify-center rounded-full text-white disabled:opacity-50", r.recording && "rec")}
      >
        <MicGlyph />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5" aria-live="polite">
        {r.recording ? (
          <div className="text-[13px] font-bold text-[#dc2626]">● Recording {fmtSecs(r.seconds)} · tap to stop</div>
        ) : notes.length ? (
          <ul className="flex flex-col gap-1.5" aria-label="Voice notes">
            {notes.map((n) => (
              <VoiceNoteChip key={n.id} note={n} onRemove={() => remove(n)} />
            ))}
          </ul>
        ) : (
          <div className="text-[13px] leading-snug text-muted">
            <b className="text-ink">Voice note</b>
            <br />
            Tap the mic to record, tap again to stop
          </div>
        )}
      </div>
    </div>
  );
}

/** "🎙 0:42 ▮▮▮ ▶ ✕" chip for a recorded note. */
export function VoiceNoteChip({ note, onRemove }: { note: VoiceNote; onRemove?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play();
  };
  return (
    <li className="flex items-center gap-2 rounded-full border border-hair bg-chip py-1 pl-3 pr-1.5 text-xs text-ink">
      <span className="shrink-0">🎙 {fmtSecs(note.durationSec)}</span>
      <span className="vn-bars flex-1" aria-hidden />
      <ChipButton on={playing} onClick={toggle} label={playing ? "Pause voice note" : "Play voice note"}>
        {playing ? "❚❚" : "▶"}
      </ChipButton>
      {onRemove ? (
        <ChipButton onClick={onRemove} label="Remove voice note">
          ✕
        </ChipButton>
      ) : null}
      <audio ref={audio} src={note.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    </li>
  );
}
