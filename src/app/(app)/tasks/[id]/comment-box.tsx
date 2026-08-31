"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTaskComment } from "../actions";
import { VoiceRecorder } from "@/components/voice-recorder";
import { Icon } from "@/components/icon";
import { uploadFileDirect } from "@/lib/upload-client";
import { fileTooLarge, MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_LABEL } from "@/lib/upload-limits";

export function CommentBox({ taskId }: { taskId: string }) {
  const [tab, setTab] = useState<"text" | "photo" | "document" | "voice">("text");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submitText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const fd = new FormData();
    fd.set("type", "text");
    fd.set("text", text);
    startTransition(async () => {
      try {
        await addTaskComment(taskId, fd);
        setText("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't post comment.");
      }
    });
  }

  function submitFile(type: "photo" | "document") {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    if (fileTooLarge(file, MAX_DIRECT_UPLOAD_BYTES)) {
      setError(`This file is too large (max ${MAX_DIRECT_UPLOAD_LABEL}).`);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const uploaded = await uploadFileDirect(file);
        const fd = new FormData();
        fd.set("type", type);
        fd.set("fileKey", uploaded.key);
        fd.set("fileMimeType", uploaded.mimeType);
        fd.set("fileOriginalName", uploaded.originalName);
        await addTaskComment(taskId, fd);
        if (fileInput.current) fileInput.current.value = "";
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't upload.");
      }
    });
  }

  function submitVoice(blob: Blob, transcript: string | null, seconds: number) {
    const fd = new FormData();
    fd.set("type", "voice");
    fd.set("voice", new File([blob], "voice-note.webm", { type: "audio/webm" }));
    if (transcript) fd.set("transcript", transcript);
    fd.set("duration", String(seconds));
    startTransition(async () => {
      try {
        await addTaskComment(taskId, fd);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't upload voice note.");
      }
    });
  }

  return (
    <div className="border-t border-border pt-4">
      <div className="mb-2 flex gap-1">
        {(["text", "photo", "document", "voice"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setError(null);
              setTab(t);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${tab === t ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {t === "text" ? "Text" : t === "photo" ? "Photo" : t === "document" ? "Document" : "Voice"}
          </button>
        ))}
      </div>

      {tab === "text" && (
        <form onSubmit={submitText} className="flex gap-2">
          <input className="input" placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={pending} className="btn btn-primary">Send</button>
        </form>
      )}
      {(tab === "photo" || tab === "document") && (
        <div className="flex items-center gap-2">
          <input ref={fileInput} type="file" accept={tab === "photo" ? "image/*" : undefined} className="flex-1 text-xs" />
          <button onClick={() => submitFile(tab)} disabled={pending} className="btn btn-primary shrink-0">
            <Icon name="upload" className="h-4 w-4" /> Upload
          </button>
        </div>
      )}
      {tab === "voice" && <VoiceRecorder onComplete={submitVoice} disabled={pending} />}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
