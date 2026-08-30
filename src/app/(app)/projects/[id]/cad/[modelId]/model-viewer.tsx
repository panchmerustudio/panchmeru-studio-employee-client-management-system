"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { buildScene, type CadEntityInput, type ValidationRow } from "@/lib/cad3d/build-scene";
import { approveCadModel } from "../actions";
import { Icon } from "@/components/icon";

/**
 * Renders the generated 3D model (Three.js, real WebGL — not a mockup),
 * shows the CAD <-> 3D validation table computed from the same geometry
 * that's on screen, and lets an approver sign off before export.
 */
export function ModelViewer({
  modelId,
  modelName,
  entities,
  windowSillMm,
  canApprove,
  canDownload,
  status,
}: {
  modelId: string;
  modelName: string;
  entities: CadEntityInput[];
  windowSillMm: number;
  canApprove: boolean;
  canDownload: boolean;
  status: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const [validation, setValidation] = useState<ValidationRow[]>([]);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { group, validation: v } = buildScene(entities, { windowSillMm });
    sceneGroupRef.current = group;
    setValidation(v);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1ea);
    scene.add(group);
    scene.add(new THREE.GridHelper(60, 60, 0xc9c3b3, 0xe7e2d6));

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(6, 12, 8);
    scene.add(dir);

    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 3);

    const height = 420;
    const width = container.clientWidth || 640;
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, maxDim * 30);
    camera.position.set(center.x + maxDim * 0.9, center.y + maxDim * 0.75, center.z + maxDim * 0.9);
    camera.lookAt(center);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth || 640;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    };
  }, [entities, windowSillMm]);

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGLB() {
    const group = sceneGroupRef.current;
    if (!group) return;
    new GLTFExporter().parse(
      group,
      (result) => downloadBlob(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }), `${slug(modelName)}.glb`),
      (err) => console.error("GLB export failed", err),
      { binary: true }
    );
  }

  function exportObj() {
    const group = sceneGroupRef.current;
    if (!group) return;
    const text = new OBJExporter().parse(group);
    downloadBlob(new Blob([text], { type: "text/plain" }), `${slug(modelName)}.obj`);
  }

  function approve() {
    setApproving(true);
    setApproveError(null);
    approveCadModel(modelId)
      .then(() => router.refresh())
      .catch((err) => setApproveError(err instanceof Error ? err.message : "Couldn't approve."))
      .finally(() => setApproving(false));
  }

  const mismatches = validation.filter((v) => v.cadValue !== v.modelValue);

  return (
    <div className="space-y-4">
      <div ref={containerRef} className="card overflow-hidden" style={{ height: 420 }} />
      <p className="text-center text-xs text-muted">Drag to orbit, scroll to zoom.</p>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">CAD ↔ 3D validation</h3>
          <span className={`badge ${mismatches.length === 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {mismatches.length === 0 ? "100% match" : `${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"}`}
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-muted">
              <tr>
                <th className="py-1 pr-2">Element</th>
                <th className="py-1 pr-2">Dimension</th>
                <th className="py-1 pr-2">CAD</th>
                <th className="py-1 pr-2">3D</th>
                <th className="py-1">Match</th>
              </tr>
            </thead>
            <tbody>
              {validation.map((v, i) => (
                <tr key={i} className={v.cadValue !== v.modelValue ? "text-red-600" : ""}>
                  <td className="py-0.5 pr-2">{v.label}</td>
                  <td className="py-0.5 pr-2">{v.dimension}</td>
                  <td className="py-0.5 pr-2">{v.cadValue.toLocaleString()} mm</td>
                  <td className="py-0.5 pr-2">{v.modelValue.toLocaleString()} mm</td>
                  <td className="py-0.5">{v.cadValue === v.modelValue ? "✅" : "⚠️"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canDownload ? (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={exportGLB} className="btn btn-secondary">
            Export GLB
          </button>
          <button onClick={exportObj} className="btn btn-secondary">
            Export OBJ
          </button>
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">View this model in-app only — only the studio owner can export it.</p>
      )}

      {canApprove && status === "ready" && (
        <div className="card p-4">
          {approveError && <p className="mb-2 text-xs text-red-600">{approveError}</p>}
          <button onClick={approve} disabled={approving || mismatches.length > 0} className="btn btn-primary w-full">
            {approving ? "Approving…" : "Approve model"}
          </button>
          {mismatches.length > 0 && <p className="mt-2 text-xs text-red-600">Resolve validation mismatches before approving.</p>}
        </div>
      )}
      {status === "approved" && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-800">
          <Icon name="check-circle" className="mr-1 inline h-4 w-4" /> Approved
        </div>
      )}
    </div>
  );
}

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || "model";
}
