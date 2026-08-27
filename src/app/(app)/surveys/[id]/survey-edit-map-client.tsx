"use client";

import dynamic from "next/dynamic";
import type { EditPoint } from "./survey-edit-map";

const SurveyEditMap = dynamic(() => import("./survey-edit-map").then((m) => m.SurveyEditMap), {
  ssr: false,
  loading: () => <div className="card h-[320px] animate-pulse bg-slate-100" />,
});

export function SurveyEditMapClient({ points, onChange }: { points: EditPoint[]; onChange: (points: EditPoint[]) => void }) {
  return <SurveyEditMap points={points} onChange={onChange} />;
}
