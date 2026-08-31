"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type TrailPoint = { latitude: number; longitude: number; recordedAt: string };

function TrailLayer({ points }: { points: TrailPoint[] }) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const group = L.layerGroup();
    if (points.length > 0) {
      const latlngs = points.map((p) => [p.latitude, p.longitude] as [number, number]);
      L.polyline(latlngs, { color: "#b45309", weight: 3, opacity: 0.7 }).addTo(group);
      L.circleMarker(latlngs[0], { radius: 6, color: "#059669", fillColor: "#059669", fillOpacity: 1 }).bindTooltip("Start").addTo(group);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: "#dc2626", fillColor: "#dc2626", fillOpacity: 1 }).bindTooltip("Last point").addTo(group);
      map.addLayer(group);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30], maxZoom: 16 });
    }
    layerRef.current = group;
    return () => {
      map.removeLayer(group);
    };
  }, [map, points]);

  return null;
}

export function LocationTrailMap({ points }: { points: TrailPoint[] }) {
  const center: [number, number] = points.length > 0 ? [points[0].latitude, points[0].longitude] : [30.9, 75.86];
  return (
    <div className="card overflow-hidden">
      <MapContainer center={center} zoom={15} style={{ height: 320, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <TrailLayer points={points} />
      </MapContainer>
    </div>
  );
}
