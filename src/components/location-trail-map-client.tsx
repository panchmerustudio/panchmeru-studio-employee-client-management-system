"use client";

import dynamic from "next/dynamic";
import type { TrailPoint } from "./location-trail-map";

const LocationTrailMap = dynamic(() => import("./location-trail-map").then((m) => m.LocationTrailMap), {
  ssr: false,
  loading: () => <div className="card h-[320px] animate-pulse bg-slate-100" />,
});

export function LocationTrailMapClient({ points }: { points: TrailPoint[] }) {
  return <LocationTrailMap points={points} />;
}
