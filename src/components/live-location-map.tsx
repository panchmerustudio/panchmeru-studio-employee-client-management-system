"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type LocationMarker = {
  id: string;
  employeeName: string;
  label: string; // e.g. "Sharma Residence" or "Office"
  latitude: number;
  longitude: number;
  color: string;
  detail: string; // e.g. "Live · updated 1m ago"
};

function dotIcon(color: string, pulse: boolean) {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:18px;height:18px">${
      pulse ? `<div style="position:absolute;inset:-6px;border-radius:50%;background:${color};opacity:0.25;animation:pulse 1.6s ease-out infinite"></div>` : ""
    }<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div></div><style>@keyframes pulse{0%{transform:scale(0.6);opacity:0.35}100%{transform:scale(1.6);opacity:0}}</style>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function MarkersLayer({ markers }: { markers: LocationMarker[] }) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const group = L.layerGroup();
    for (const m of markers) {
      const marker = L.marker([m.latitude, m.longitude], { icon: dotIcon(m.color, m.detail.startsWith("Live")) });
      marker.bindPopup(`<div style="font-size:13px"><strong>${escapeHtml(m.employeeName)}</strong><br/>${escapeHtml(m.label)}<br/><span style="color:#64748b">${escapeHtml(m.detail)}</span></div>`);
      group.addLayer(marker);
    }
    map.addLayer(group);
    layerRef.current = group;
    if (markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [m.latitude, m.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    }
    return () => {
      map.removeLayer(group);
    };
  }, [map, markers]);

  return null;
}

export function LiveLocationMap({ markers }: { markers: LocationMarker[] }) {
  const center: [number, number] = markers.length > 0 ? [markers[0].latitude, markers[0].longitude] : [30.9, 75.86];
  return (
    <div className="card overflow-hidden">
      <MapContainer center={center} zoom={11} style={{ height: 360, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MarkersLayer markers={markers} />
      </MapContainer>
    </div>
  );
}
