"use client";

/** Manual boundary correction map (section 22-24) — drag a point to move it. Never touches the raw walk; the parent form writes moves into the adjusted* columns only, with a mandatory reason. */

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type EditPoint = { lat: number; lng: number };

function numberedIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:#2563eb;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.5);cursor:grab">${n}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function EditableLayer({ points, onChange }: { points: EditPoint[]; onChange: (points: EditPoint[]) => void }) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  const pointsRef = useRef(points);
  const fittedRef = useRef(false);
  pointsRef.current = points;

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    return () => {
      map.removeLayer(group);
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    if (points.length === 0) return;

    const polygon = L.polygon(points.map((p) => [p.lat, p.lng] as [number, number]), { color: "#2563eb", weight: 2, fillColor: "#2563eb", fillOpacity: 0.1 }).addTo(group);

    points.forEach((p, i) => {
      const marker = L.marker([p.lat, p.lng], { draggable: true, icon: numberedIcon(i + 1) }).addTo(group);
      marker.on("drag", () => {
        const latlng = marker.getLatLng();
        polygon.setLatLngs(pointsRef.current.map((pt, j) => (j === i ? [latlng.lat, latlng.lng] : [pt.lat, pt.lng])) as [number, number][]);
      });
      marker.on("dragend", () => {
        const latlng = marker.getLatLng();
        onChange(pointsRef.current.map((pt, j) => (j === i ? { lat: latlng.lat, lng: latlng.lng } : pt)));
      });
    });

    if (!fittedRef.current) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 21 });
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, points]);

  return null;
}

export function SurveyEditMap({ points, onChange }: { points: EditPoint[]; onChange: (points: EditPoint[]) => void }) {
  const center: [number, number] = points[0] ? [points[0].lat, points[0].lng] : [30.9, 75.86];
  return (
    <div className="card overflow-hidden">
      <MapContainer center={center} zoom={19} style={{ height: 320, width: "100%" }}>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={22} />
        <EditableLayer points={points} onChange={onChange} />
      </MapContainer>
      <p className="border-t border-border px-3 py-2 text-xs text-muted">Drag a numbered pin to correct its position.</p>
    </div>
  );
}
