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
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // The model's own auto-fit framing (center + a size scale), captured once
  // per build so the on-screen zoom/fit buttons below can move the camera
  // without re-walking the whole scene graph on every tap.
  const fitRef = useRef<{ center: THREE.Vector3; maxDim: number } | null>(null);
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

    // Real floor plans can carry hundreds of walls (646, in one reported
    // case) — shadow-mapped, textured rendering at full quality for every
    // one of them is exactly what left this pane stuck blank on a phone
    // GPU. Scale shadow resolution/pixel ratio down for a big model, and
    // drop shadows entirely past a point, so a large drawing still renders
    // — just flatter-looking — instead of hanging.
    let meshCount = 0;
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshCount++;
    });
    const heavyScene = meshCount > 400;
    const veryHeavyScene = meshCount > 900;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1ea);
    scene.add(group);
    const grid = new THREE.GridHelper(60, 60, 0xc9c3b3, 0xe7e2d6);
    scene.add(grid);

    // Soft sky/ground fill plus one shadow-casting sun — walls/floor/
    // furniture below all set castShadow/receiveShadow, so this is what
    // actually grounds them instead of the flat, shadowless look before.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3428, 0.55));
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 3);

    const dir = new THREE.DirectionalLight(0xfff3df, 2.2);
    dir.position.set(center.x + maxDim * 0.6, center.y + maxDim * 1.2, center.z + maxDim * 0.5);
    dir.target.position.copy(center);
    dir.castShadow = !veryHeavyScene;
    const shadowMapRes = heavyScene ? 1024 : 2048;
    dir.shadow.mapSize.set(shadowMapRes, shadowMapRes);
    dir.shadow.bias = -0.0005;
    const shadowExtent = maxDim * 0.75;
    dir.shadow.camera.left = -shadowExtent;
    dir.shadow.camera.right = shadowExtent;
    dir.shadow.camera.top = shadowExtent;
    dir.shadow.camera.bottom = -shadowExtent;
    dir.shadow.camera.near = 0.1;
    dir.shadow.camera.far = maxDim * 4;
    scene.add(dir);
    scene.add(dir.target);

    const height = 420;
    const width = container.clientWidth || 640;
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, maxDim * 30);
    camera.position.set(center.x + maxDim * 0.9, center.y + maxDim * 0.75, center.z + maxDim * 0.9);
    camera.lookAt(center);

    const renderer = new THREE.WebGLRenderer({ antialias: !heavyScene });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, heavyScene ? 1 : 2));
    renderer.shadowMap.enabled = !veryHeavyScene;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    // Without explicit bounds OrbitControls' default is 0..Infinity, so a
    // pinch/scroll that overshoots can dolly the camera inside the geometry
    // (looks like "nothing is happening") or out to a speck. Scaling the
    // bounds to this model's own size keeps zoom usable at any scale, from
    // a small room to a large multi-wing site.
    controls.minDistance = maxDim * 0.01;
    controls.maxDistance = maxDim * 25;

    cameraRef.current = camera;
    controlsRef.current = controls;
    fitRef.current = { center: center.clone(), maxDim };

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
      cameraRef.current = null;
      controlsRef.current = null;
      fitRef.current = null;
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            // The wall material's canvas textures (map/bumpMap) aren't
            // freed by mat.dispose() alone. That material is shared by
            // every wall in the building (see getWallMaterial() in
            // build-scene.ts), so this runs many times against the same
            // instance across a big model — harmless, dispose() is
            // idempotent — and against the same module-level cache across
            // different model views, which just means Three silently
            // re-uploads it next time it's used rather than actually
            // leaking anything.
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.map?.dispose();
              mat.bumpMap?.dispose();
            }
            mat.dispose();
          }
        }
      });
    };
  }, [entities, windowSillMm]);

  /*
    Pinch-to-zoom on the canvas should already work (OrbitControls sets
    touch-action:none on it), but on a phone two-finger gestures over a
    small embedded viewer are easy to miss or mistake for a one-finger
    orbit drag — reported as "not able to zoom". These buttons give a
    tap-driven way to zoom that doesn't depend on a multi-touch gesture
    landing cleanly on the canvas at all, which is the reliable fix
    regardless of what's making pinch itself unreliable on a given phone.
  */
  function zoomBy(factor: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const dist = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    offset.setLength(dist);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  function resetView() {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const fit = fitRef.current;
    if (!camera || !controls || !fit) return;
    const { center, maxDim } = fit;
    camera.position.set(center.x + maxDim * 0.9, center.y + maxDim * 0.75, center.z + maxDim * 0.9);
    controls.target.copy(center);
    controls.update();
  }

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
      <div className="relative">
        <div ref={containerRef} className="card overflow-hidden" style={{ height: 420, touchAction: "none" }} />
        <div className="absolute right-2 bottom-2 flex flex-col gap-1">
          <button type="button" onClick={() => zoomBy(0.7)} aria-label="Zoom in" className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 text-foreground shadow active:bg-white">
            <Icon name="plus" className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => zoomBy(1 / 0.7)} aria-label="Zoom out" className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 text-foreground shadow active:bg-white">
            <Icon name="minus" className="h-5 w-5" />
          </button>
          <button type="button" onClick={resetView} aria-label="Reset view" className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 text-foreground shadow active:bg-white">
            <Icon name="maximize" className="h-5 w-5" />
          </button>
        </div>
      </div>
      <p className="text-center text-xs text-muted">Drag to orbit, pinch or use the +/− buttons to zoom.</p>

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
