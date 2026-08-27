"use client";

import dynamic from "next/dynamic";
import type { LivePoint } from "./survey-live-map";

const SurveyLiveMap = dynamic(() => import("./survey-live-map").then((m) => m.SurveyLiveMap), {
  ssr: false,
  loading: () => <div className="card h-[320px] animate-pulse bg-slate-100" />,
});

export function SurveyLiveMapClient({ points, current }: { points: LivePoint[]; current: { lat: number; lng: number; accuracy: number } | null }) {
  return <SurveyLiveMap points={points} current={current} />;
}
