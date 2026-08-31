"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDrawing, requestRevision } from "../actions";
import { VoiceRecorder } from "@/components/voice-recorder";
import { Icon } from "@/components/icon";
import { uploadFileDirect } from "@/lib/upload-client";
import { fileTooLarge, MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_LABEL } from "@/lib/upload-limits";

export function DrawingActions({ shareId, alreadyApproved }: { shareId: string; alreadyApproved: boolean }) {
  const [mode, setMode] = useState<"idle" | "revision">("idle");
  const [text, setText] = useState("");
  const [attachmentTab, setAttachmentTab] = useState<"none" | "photo" | "voice">("none");
  const [voiceNote, setVoiceNote] = useState<{ blob: Blob; transcript: string | null; seconds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const photoInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function approve() {
    if (!window.confirm("Are you sure you want to approve this drawing? This marks it as final.")) return;
    setError(null);
    startTransition(async () => {
      try {
        await approveDrawing(shareId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't approve this drawing.");
      }
    });
  }

  function submitRevision() {
    if (!text.trim()) {
      setError("Please describe what needs to change.");
      return;
    }
    const photoFile = attachmentTab === "photo" ? photoInput.current?.files?.[0] : undefined;
    if (photoFile && fileTooLarge(photoFile, MAX_DIRECT_UPLOAD_BYTES)) {
      setError(`This photo is too large (max ${MAX_DIRECT_UPLOAD_LABEL}).`);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        let requestText = text.trim();

        if (attachmentTab === "photo" && photoFile) {
          const uploaded = await uploadFileDirect(photoFile, "/api/uploads/presign-client");
          fd.set("attachmentKey", uploaded.key);
          fd.set("attachmentMimeType", uploaded.mimeType);
          fd.set("attachmentOriginalName", uploaded.originalName);
        } else if (attachmentTab === "voice" && voiceNote) {
          const file = new File([voiceNote.blob], "revision-voice-note.webm", { type: "audio/webm" });
          const uploaded = await uploadFileDirect(file, "/api/uploads/presign-client");
          fd.set("attachmentKey", uploaded.key);
          fd.set("attachmentMimeType", uploaded.mimeType);
          fd.set("attachmentOriginalName", uploaded.originalName);
          if (voiceNote.transcript) requestText += `\n\n(Voice note: "${voiceNote.transcript}")`;
        }

        fd.set("requestText", requestText);
        await requestRevision(shareId, fd);
        setMode("idle");
        setText("");
        setAttachmentTab("none");
        setVoiceNote(null);
        if (photoInput.current) photoInput.current.value = "";
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't send this revision request.");
      }
    });
  }

  if (alreadyApproved) {
    return (
      <div className="card flex items-center gap-2 border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800">
        <Icon name="check-circle" className="h-4 w-4" /> You approved this drawing.
      </div>
    );
  }

  if (mode === "idle") {
    return (
      <div className="space-y-2">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={approve} disabled={pending} className="btn btn-primary flex-1">
            <Icon name="check-circle" className="h-4 w-4" /> Approve
          </button>
          <button onClick={() => setMode("revision")} disabled={pending} className="btn btn-secondary flex-1">
            <Icon name="edit" className="h-4 w-4" /> Request revision
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold">Request a revision</h3>
      <textarea
        className="input"
        rows={3}
        placeholder="What needs to change? e.g. &quot;Please change the location of these two switches.&quot;"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex gap-1">
        {(["none", "photo", "voice"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setAttachmentTab(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${attachmentTab === t ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {t === "none" ? "No attachment" : t === "photo" ? "Add photo" : "Voice note"}
          </button>
        ))}
      </div>

      {attachmentTab === "photo" && <input ref={photoInput} type="file" accept="image/*" className="w-full text-xs" />}
      {attachmentTab === "voice" &&
        (voiceNote ? (
          <div className="flex items-center gap-2">
            <audio controls src={URL.createObjectURL(voiceNote.blob)} className="h-9 flex-1" />
            <button type="button" onClick={() => setVoiceNote(null)} className="text-xs text-red-600">
              Remove
            </button>
          </div>
        ) : (
          <VoiceRecorder onComplete={(blob, transcript, seconds) => setVoiceNote({ blob, transcript, seconds })} disabled={pending} />
        ))}

      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={submitRevision} disabled={pending} className="btn btn-primary flex-1">
          {pending ? "Sending…" : "Send request"}
        </button>
        <button onClick={() => setMode("idle")} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
