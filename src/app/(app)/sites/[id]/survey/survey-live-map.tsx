"use client";

/**
 * Live boundary-walk map (section 5/8): shows the polyline/polygon growing
 * as the surveyor walks, the current GPS fix with its accuracy radius, and
 * the explicit start point. Separate component from the static multi-site
 * overview map (site-map.tsx) — this one updates on every fix, not once.
 */

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type LivePoint = { lat: number; lng: number; isOutlier?: boolean };

function dotIcon(color: string, size = 14) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.5)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function LiveLayers({ points, current }: { points: LivePoint[]; current: { lat: number; lng: number; accuracy: number } | null }) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);
  const hasFitRef = useRef(false);

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;
    return () => {
      map.removeLayer(group);
    };
  }, [map]);

  useEffect(() => {
    const group = layerRef.current;
    if (!group) return;
    group.clearLayers();

    const kept = points.filter((p) => !p.isOutlier);
    if (kept.length >= 2) {
      L.polyline(
        kept.map((p) => [p.lat, p.lng]),
        { color: "#b45309", weight: 3 }
      ).addTo(group);
    }
    if (kept.length >= 3) {
      L.polygon(
        kept.map((p) => [p.lat, p.lng]),
        { color: "#b45309", weight: 2, fillColor: "#f59e0b", fillOpacity: 0.15, dashArray: "4 4" }
      ).addTo(group);
    }
    points.forEach((p, i) => {
      if (p.isOutlier) {
        L.marker([p.lat, p.lng], { icon: dotIcon("#dc2626", 10) }).bindTooltip("Flagged — GPS jump/low accuracy").addTo(group);
      } else if (i === 0) {
        L.marker([p.lat, p.lng], { icon: dotIcon("#059669", 16) }).bindTooltip("Start point").addTo(group);
      } else {
        L.marker([p.lat, p.lng], { icon: dotIcon("#b45309", 8) }).addTo(group);
      }
    });

    if (current) {
      L.marker([current.lat, current.lng], { icon: dotIcon("#2563eb", 14) }).addTo(group);
      L.circle([current.lat, current.lng], { radius: current.accuracy, color: "#2563eb", weight: 1, fillOpacity: 0.08 }).addTo(group);
    }

    const focus = current ?? kept[kept.length - 1];
    if (focus) {
      if (!hasFitRef.current) {
        map.setView([focus.lat, focus.lng], 19);
        hasFitRef.current = true;
      } else {
        map.panTo([focus.lat, focus.lng], { animate: true });
      }
    }
  }, [map, points, current]);

  return null;
}

export function SurveyLiveMap({ points, current }: { points: LivePoint[]; current: { lat: number; lng: number; accuracy: number } | null }) {
  const initialCenter: [number, number] = current ? [current.lat, current.lng] : points[0] ? [points[0].lat, points[0].lng] : [30.9, 75.86];
  return (
    <div className="card overflow-hidden">
      <MapContainer center={initialCenter} zoom={19} style={{ height: 320, width: "100%" }} scrollWheelZoom={true}>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={22} />
        <LiveLayers points={points} current={current} />
      </MapContainer>
    </div>
  );
}
