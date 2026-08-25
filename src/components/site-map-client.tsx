"use client";

import dynamic from "next/dynamic";
import type { MapSite } from "./site-map";

const SiteMap = dynamic(() => import("./site-map").then((m) => m.SiteMap), {
  ssr: false,
  loading: () => <div className="card h-[360px] animate-pulse bg-slate-100" />,
});

export function SiteMapClient({ sites }: { sites: MapSite[] }) {
  return <SiteMap sites={sites} />;
}
