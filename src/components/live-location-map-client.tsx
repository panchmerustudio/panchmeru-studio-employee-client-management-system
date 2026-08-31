"use client";

import dynamic from "next/dynamic";
import type { LocationMarker } from "./live-location-map";

const LiveLocationMap = dynamic(() => import("./live-location-map").then((m) => m.LiveLocationMap), {
  ssr: false,
  loading: () => <div className="card h-[360px] animate-pulse bg-slate-100" />,
});

export function LiveLocationMapClient({ markers }: { markers: LocationMarker[] }) {
  return <LiveLocationMap markers={markers} />;
}
