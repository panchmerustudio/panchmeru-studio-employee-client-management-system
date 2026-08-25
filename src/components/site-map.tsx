"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";

export type MapSite = {
  id: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  healthStatus: "normal" | "attention" | "urgent";
};

const HEALTH_COLOR: Record<string, string> = { normal: "#059669", attention: "#d97706", urgent: "#dc2626" };

function dotIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function ClusterLayer({ sites }: { sites: MapSite[] }) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    const group = (L as unknown as { markerClusterGroup: () => L.MarkerClusterGroup }).markerClusterGroup();
    for (const site of sites) {
      const marker = L.marker([site.latitude, site.longitude], { icon: dotIcon(HEALTH_COLOR[site.healthStatus]) });
      marker.bindPopup(
        `<div style="font-size:13px"><strong>${escapeHtml(site.name)}</strong><br/>${escapeHtml(site.city)}<br/><a href="/sites/${site.id}" style="color:#b45309;font-weight:600">Open site →</a></div>`
      );
      group.addLayer(marker);
    }
    map.addLayer(group);
    groupRef.current = group;
    if (sites.length > 0) {
      const bounds = L.latLngBounds(sites.map((s) => [s.latitude, s.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    }
    return () => {
      map.removeLayer(group);
    };
  }, [map, sites]);

  return null;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function SiteMap({ sites }: { sites: MapSite[] }) {
  const center: [number, number] = sites.length > 0 ? [sites[0].latitude, sites[0].longitude] : [30.9, 75.86];
  return (
    <div className="card overflow-hidden">
      <MapContainer center={center} zoom={10} style={{ height: 360, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClusterLayer sites={sites} />
      </MapContainer>
    </div>
  );
}
