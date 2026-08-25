"use client";

import { useRef, useState } from "react";
import { Icon } from "./icon";

/**
 * Records a voice note (MediaRecorder -> audio blob, always kept) while
 * simultaneously running the browser's free on-device speech recognition
 * for a best-effort live transcript (section 31/17: both original audio
 * and transcription are retained). Recognition isn't supported in every
 * browser — when it isn't, we still keep the audio and just skip the
 * transcript rather than failing the recording.
 */
export function VoiceRecorder({ onComplete, disabled }: { onComplete: (blob: Blob, transcript: string | null, seconds: number) => void; disabled?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number>(0);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      transcriptRef.current = "";
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.current.push(e.data);
      recorder.start();
      mediaRecorder.current = recorder;
      startedAt.current = Date.now();
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 250);

      const SpeechRecognitionCtor: SpeechRecognitionCtor | undefined =
        (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
      if (SpeechRecognitionCtor) {
        const rec = new SpeechRecognitionCtor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-IN";
        rec.onresult = (event: SpeechRecognitionEventLike) => {
          let text = "";
          for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript + " ";
          transcriptRef.current = text.trim();
        };
        rec.onerror = () => {};
        try {
          rec.start();
          recognition.current = rec;
        } catch {
          recognition.current = null;
        }
      }

      setRecording(true);
    } catch {
      setError("Microphone permission is required to record a voice note.");
    }
  }

  function stop() {
    const recorder = mediaRecorder.current;
    if (!recorder) return;
    recorder.onstop = () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      const dur = Math.round((Date.now() - startedAt.current) / 1000);
      onComplete(blob, transcriptRef.current || null, dur);
    };
    recorder.stop();
    recorder.stream.getTracks().forEach((t) => t.stop());
    recognition.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setSeconds(0);
  }

  return (
    <div className="flex items-center gap-2">
      {!recording ? (
        <button type="button" onClick={start} disabled={disabled} className="btn btn-secondary">
          <Icon name="mic" className="h-4 w-4" /> Record voice note
        </button>
      ) : (
        <button type="button" onClick={stop} className="btn btn-danger animate-pulse">
          <Icon name="mic" className="h-4 w-4" /> Stop ({seconds}s)
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// Minimal ambient types for the non-standard Web Speech API (no @types package needed).
interface SpeechRecognitionEventLike {
  results: { [i: number]: { [j: number]: { transcript: string } }; length: number };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEventLike) => void;
  onerror: (event: unknown) => void;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
