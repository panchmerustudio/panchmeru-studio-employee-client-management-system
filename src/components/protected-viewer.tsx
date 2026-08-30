"use client";

import { useEffect, useRef, useState } from "react";

/**
 * In-app-only document viewer (section: "no download outside the app").
 *
 * Be honest about what this can and can't do: no website can block an OS
 * screenshot or a phone photo of the screen — there is no browser API for
 * that. What this component actually does is remove every ordinary way to
 * casually save or share the file (no <img>/<a href> with the real bytes,
 * no native browser PDF toolbar with its own download button, no
 * right-click "save as", Ctrl+S/Ctrl+P intercepted) and burns a watermark
 * — who viewed it and when — directly into the rendered pixels, so a
 * screenshot that does get out is traceable back to whoever took it.
 *
 * PDFs and images are rendered page-by-page onto <canvas> (never handed to
 * the browser's own PDF plugin or an <img> tag). Other file types (Office
 * docs, DWG/DXF) have no in-browser renderer here — that's disclosed
 * rather than faked.
 */

const RENDERABLE_IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProtectedViewer({
  fileId,
  mimeType,
  originalName,
  watermarkLines,
  downloadHref,
}: {
  fileId: string;
  mimeType: string;
  originalName: string;
  /** Viewer identity only (name, email, ...) — a live "viewed at" timestamp is appended automatically at render time. */
  watermarkLines: string[];
  /** Only passed when the viewer is actually allowed to save the original — renders a real download button alongside the protected preview. */
  downloadHref?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unsupported" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const stampLines = useRef<string[]>(undefined);
  if (!stampLines.current) stampLines.current = [...watermarkLines, new Date().toLocaleString()];

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const ctrlish = e.ctrlKey || e.metaKey;
      if (ctrlish && (e.key === "s" || e.key === "S" || e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    setStatus("loading");
    setErrorMsg(null);

    async function run() {
      if (!RENDERABLE_IMAGE.has(mimeType) && mimeType !== "application/pdf") {
        if (!cancelled) setStatus("unsupported");
        return;
      }

      const res = await fetch(`/api/files/${fileId}`, { cache: "no-store" });
      if (!res.ok) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(res.status === 403 ? "You don't have permission to view this file." : "Couldn't load this file.");
        }
        return;
      }
      const buf = await res.arrayBuffer();
      if (cancelled || !container) return;

      if (RENDERABLE_IMAGE.has(mimeType)) {
        const blob = new Blob([buf], { type: mimeType });
        const bitmap = await createImageBitmap(blob);
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.style.width = "100%";
        canvas.style.display = "block";
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        stampWatermark(ctx, canvas.width, canvas.height, stampLines.current!);
        container.appendChild(canvas);
        if (!cancelled) setStatus("ready");
        return;
      }

      // application/pdf
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      if (cancelled) return;
      const pageCount = Math.min(doc.numPages, 40);
      for (let i = 1; i <= pageCount; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.style.display = "block";
        canvas.style.marginBottom = "8px";
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        stampWatermark(ctx, canvas.width, canvas.height, stampLines.current!);
        container.appendChild(canvas);
      }
      if (!cancelled) {
        setStatus("ready");
        if (doc.numPages > pageCount) setErrorMsg(`Showing the first ${pageCount} of ${doc.numPages} pages.`);
      }
    }

    run().catch((err) => {
      if (!cancelled) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Couldn't render this file.");
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, mimeType]);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        className="max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-slate-50 p-2"
        style={{ userSelect: "none" }}
      >
        {status === "loading" && <p className="p-6 text-center text-sm text-muted">Loading preview…</p>}
        {status === "unsupported" && (
          <p className="p-6 text-center text-sm text-muted">
            In-app preview isn&apos;t available for this file type ({originalName.split(".").pop()?.toUpperCase()}) yet.
            {downloadHref ? " Use the download button below." : " Ask the studio owner if you need this file."}
          </p>
        )}
        {status === "error" && <p className="p-6 text-center text-sm text-red-600">{errorMsg}</p>}
      </div>
      {status === "ready" && (
        <p className="text-center text-xs text-muted">In-app view only — watermarked to {watermarkLines[0] || "you"}. Screenshots remain traceable, not blocked.</p>
      )}
      {errorMsg && status === "ready" && <p className="text-center text-xs text-muted">{errorMsg}</p>}
      {downloadHref && (
        <a href={downloadHref} className="btn btn-secondary w-full">
          Download original
        </a>
      )}
    </div>
  );
}

function stampWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, lines: string[]) {
  if (lines.length === 0) return;
  const text = lines.filter(Boolean).join("  •  ");
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = "#0f172a";
  const fontSize = Math.max(14, Math.round(width / 32));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  const stepY = fontSize * 6;
  const stepX = ctx.measureText(text).width + fontSize * 4;
  const rows = Math.ceil((height * 1.8) / stepY);
  const cols = Math.ceil((width * 1.8) / stepX);
  for (let r = -rows; r <= rows; r++) {
    for (let c = -cols; c <= cols; c++) {
      ctx.fillText(text, c * stepX, r * stepY);
    }
  }
  ctx.restore();
}
