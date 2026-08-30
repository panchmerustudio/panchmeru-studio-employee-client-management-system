"use client";

import dynamic from "next/dynamic";
import type { CadEntityInput } from "@/lib/cad3d/build-scene";

const ModelViewer = dynamic(() => import("./model-viewer").then((m) => m.ModelViewer), {
  ssr: false,
  loading: () => <div className="card h-[420px] animate-pulse bg-slate-100" />,
});

export function ModelViewerClient(props: { modelId: string; modelName: string; entities: CadEntityInput[]; windowSillMm: number; canApprove: boolean; canDownload: boolean; status: string }) {
  return <ModelViewer {...props} />;
}
