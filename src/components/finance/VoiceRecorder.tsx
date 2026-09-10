"use client";
import { useEffect, useRef, useState } from "react";

/** In-browser MediaRecorder → webm blob (SPEC §11.2 voice note per expense). */
export function VoiceRecorder({ onChange, existingUrl }: { onChange: (blob: Blob | null, durationSec: number) => void; existingUrl?: string | null }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(existingUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        const dur = Math.round((Date.now() - startedAt.current) / 1000);
        setUrl(URL.createObjectURL(blob));
        onChange(blob, dur);
      };
      rec.current = r;
      startedAt.current = Date.now();
      setSeconds(0);
      timer.current = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 500);
      r.start();
      setRecording(true);
    } catch {
      setError("Microphone unavailable");
    }
  }
  function stop() {
    rec.current?.stop();
    if (timer.current) clearInterval(timer.current);
    setRecording(false);
  }
  function clear() {
    setUrl(null);
    onChange(null, 0);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {recording ? (
        <button type="button" onClick={stop} className="touch-target rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white">
          ■ Stop ({seconds}s)
        </button>
      ) : (
        <button type="button" onClick={start} className="touch-target rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
          🎤 {url ? "Re-record" : "Record voice note"}
        </button>
      )}
      {url ? <audio controls src={url} className="h-9 max-w-[200px]" /> : null}
      {url ? (
        <button type="button" onClick={clear} className="text-xs text-gray-500 underline">
          remove
        </button>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
