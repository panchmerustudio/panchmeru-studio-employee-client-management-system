"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import {
  buildScene,
  buildFloorFinishMaterial,
  buildGroundMaterial,
  buildSkyBackground,
  FLOOR_FINISHES,
  type CadEntityInput,
  type ValidationRow,
  type FloorRegion,
} from "@/lib/cad3d/build-scene";
import { approveCadModel } from "../actions";
import { Icon } from "@/components/icon";
import { SourceDrawing2D } from "./source-drawing-2d";

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
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // The model's own auto-fit framing (center + a size scale), captured once
  // per build so the on-screen zoom/fit buttons below can move the camera
  // without re-walking the whole scene graph on every tap.
  const fitRef = useRef<{ center: THREE.Vector3; maxDim: number } | null>(null);
  const [validation, setValidation] = useState<ValidationRow[]>([]);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [rendering, setRendering] = useState(false);
  // The paint/tile picker for whichever room floor was last tapped — see
  // FloorRegion in build-scene.ts (a room boundary recovered from the
  // wall/door layout, not something the DXF itself provides).
  const floorRegionsRef = useRef<FloorRegion[]>([]);
  const [paintPanel, setPaintPanel] = useState<{ regionId: string; roomLabel: string | null; areaM2: number; finishId: string } | null>(null);
  const router = useRouter();

  // "I should be able to see that drawing as well so that I can compare
  // whether the 3D model generated is according to the drawing" — a flat
  // 2D read-out of the exact same entities the 3D model is built from,
  // shown side by side so a mismatch is something a person can actually
  // point at (see source-drawing-2d.tsx's doc for what it is/isn't). On by
  // default whenever there's something for it to show.
  const hasSourceDrawing = entities.some((e) => e.type === "elevation_panel" || e.type === "wall" || e.type === "room");
  const [showDrawing, setShowDrawing] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { group, validation: v, focusBox, floorRegions } = buildScene(entities, { windowSillMm });
    sceneGroupRef.current = group;
    floorRegionsRef.current = floorRegions;
    setValidation(v);
    setViewMenuOpen(false);
    setPaintPanel(null);

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
    scene.add(group);
    sceneRef.current = scene;

    // sceneBox covers EVERY entity — used only for how far the camera is
    // allowed to pull back and where the far clip plane sits, so nothing
    // gets clipped if the person zooms/pans out to see other parts of the
    // drawing. focusBox/focusCenter/focusMaxDim (the largest — or most
    // furnished — contiguous cluster of walls, see computeFocusBox's doc)
    // is what the camera actually starts framed on. A real DWG often packs
    // more than one disconnected floor plan/detail onto one sheet; framing
    // the initial view on the FULL bounding box of all of them at once is
    // what made walls and furniture shrink to illegible flat lines even
    // after zooming in a little — the camera had to back out for kilometers
    // to fit everything, so a 3m-tall wall was sub-pixel from that far away.
    //
    // Computed here — before the ground/grid/lights below — because none of
    // those raw CAD coordinates are ever recentered near the world origin
    // (toThree() in build-scene.ts scales them, it doesn't translate them),
    // so a real building can sit anywhere in world space. The ground plane
    // and grid need focusCenter/focusMaxDim for the same reason the sun
    // light and shadow frustum already did — a fixed-at-origin grid is
    // invisible or irrelevant once a building isn't near (0,0,0).
    const sceneBox = new THREE.Box3().setFromObject(group);
    const sceneSize = sceneBox.getSize(new THREE.Vector3());
    const sceneMaxDim = Math.max(sceneSize.x, sceneSize.y, sceneSize.z, 3);

    const focusCenter = focusBox ? focusBox.getCenter(new THREE.Vector3()) : sceneBox.getCenter(new THREE.Vector3());
    const focusSize = focusBox ? focusBox.getSize(new THREE.Vector3()) : sceneSize;
    const focusMaxDim = Math.max(focusSize.x, focusSize.y, focusSize.z, 3);

    // Gradient sky behind the model instead of a flat wall color, and a
    // textured ground plane (in place of the old fixed 60x60 grid that was
    // stuck at the world origin regardless of where the building's own
    // coordinates actually put it) sized and centered on the whole scene so
    // it still reads as ground under every cluster, not just the focused
    // one. A faint grid line overlay stays on top of it, but now follows
    // the focused cluster the same way the sun light already does.
    scene.background = buildSkyBackground();
    const groundY = (focusBox ?? sceneBox).min.y - 0.005;
    const groundSizeM = Math.max(sceneMaxDim * 4, 20);
    const sceneCenter = sceneBox.getCenter(new THREE.Vector3());
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSizeM, groundSizeM), buildGroundMaterial(groundSizeM));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(sceneCenter.x, groundY, sceneCenter.z);
    ground.receiveShadow = true;
    scene.add(ground);

    const gridSize = Math.max(focusMaxDim * 3, 10);
    const gridDivisions = Math.min(100, Math.max(10, Math.round(gridSize)));
    const grid = new THREE.GridHelper(gridSize, gridDivisions, 0xc9c3b3, 0xe7e2d6);
    grid.position.set(focusCenter.x, groundY + 0.003, focusCenter.z);
    scene.add(grid);

    // Soft sky/ground fill plus one shadow-casting sun — walls/floor/
    // furniture below all set castShadow/receiveShadow, so this is what
    // actually grounds them instead of the flat, shadowless look before.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3428, 0.55));
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    const dir = new THREE.DirectionalLight(0xfff3df, 2.2);
    dir.position.set(focusCenter.x + focusMaxDim * 0.6, focusCenter.y + focusMaxDim * 1.2, focusCenter.z + focusMaxDim * 0.5);
    dir.target.position.copy(focusCenter);
    dir.castShadow = !veryHeavyScene;
    const shadowMapRes = heavyScene ? 1024 : 2048;
    dir.shadow.mapSize.set(shadowMapRes, shadowMapRes);
    dir.shadow.bias = -0.0005;
    // Sized to the focused cluster, not the whole scene — a shadow frustum
    // stretched to cover a kilometer-wide scattered site would spread the
    // same shadow-map pixels so thin the room actually on screen would get
    // no visible shadow detail at all.
    const shadowExtent = focusMaxDim * 0.75;
    dir.shadow.camera.left = -shadowExtent;
    dir.shadow.camera.right = shadowExtent;
    dir.shadow.camera.top = shadowExtent;
    dir.shadow.camera.bottom = -shadowExtent;
    dir.shadow.camera.near = 0.1;
    dir.shadow.camera.far = focusMaxDim * 4;
    scene.add(dir);
    scene.add(dir.target);

    // Cool, dim bounce-light fill from the opposite side of the sun — no
    // shadow casting (that's what the ambient/hemisphere lights above are
    // for on their own, but a directional fill reads more like real sky
    // bounce off one side of a building than a flat ambient term alone,
    // softening the previously fully-black unlit faces).
    const fill = new THREE.DirectionalLight(0xbdd6ea, 0.55);
    fill.position.set(focusCenter.x - focusMaxDim * 0.7, focusCenter.y + focusMaxDim * 0.4, focusCenter.z - focusMaxDim * 0.6);
    fill.target.position.copy(focusCenter);
    fill.castShadow = false;
    scene.add(fill);
    scene.add(fill.target);

    const height = 420;
    const width = container.clientWidth || 640;
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, sceneMaxDim * 30);
    camera.position.set(focusCenter.x + focusMaxDim * 0.9, focusCenter.y + focusMaxDim * 0.75, focusCenter.z + focusMaxDim * 0.9);
    camera.lookAt(focusCenter);

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
    controls.target.copy(focusCenter);
    controls.enableDamping = true;
    // Without explicit bounds OrbitControls' default is 0..Infinity, so a
    // pinch/scroll that overshoots can dolly the camera inside the geometry
    // (looks like "nothing is happening"). minDistance tracks the focused
    // cluster so close-up zoom stays usable even on a huge site; maxDistance
    // tracks the WHOLE scene so there's still room to pull back and find
    // other parts of a multi-cluster drawing.
    controls.minDistance = focusMaxDim * 0.01;
    controls.maxDistance = sceneMaxDim * 25;

    cameraRef.current = camera;
    controlsRef.current = controls;
    fitRef.current = { center: focusCenter.clone(), maxDim: focusMaxDim };

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

    /*
      "give the option to fill... one room boundary with... tiles or...
      color paints" — tapping a room's floor opens the picker below the
      canvas. Distinguished from an orbit-drag by movement distance between
      pointerdown/pointerup (OrbitControls itself doesn't expose a
      "was this a click" signal), same pattern as a typical map/3D-viewer
      click-vs-pan check.
    */
    let downPos: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    function pickFloorRegion(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      const meshes = floorRegionsRef.current.map((r) => r.object);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length === 0) {
        setPaintPanel(null);
        return;
      }
      const hitMesh = hits[0].object;
      const region = floorRegionsRef.current.find((r) => r.object === hitMesh);
      if (!region) return;
      const finishId = (hitMesh.userData as { finishId?: string }).finishId ?? "tile-cream";
      setPaintPanel({ regionId: region.id, roomLabel: region.roomLabel, areaM2: region.areaM2, finishId });
    }
    const onPointerDown = (ev: PointerEvent) => {
      downPos = { x: ev.clientX, y: ev.clientY };
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (!downPos) return;
      const moved = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
      downPos = null;
      if (moved < 6) pickFloorRegion(ev.clientX, ev.clientY);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      renderer.dispose();
      cameraRef.current = null;
      controlsRef.current = null;
      fitRef.current = null;
      sceneRef.current = null;
      floorRegionsRef.current = [];
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

  type ViewPreset = "top" | "bottom" | "front" | "back" | "left" | "right" | "iso";

  /**
   * Snaps the camera to a standard architectural view — same idea as the
   * elevation/plan views a person would flip between in SketchUp or Revit.
   * Reuses the live perspective camera/OrbitControls (not a one-off
   * orthographic camera) so orbiting/zooming keeps working normally right
   * after picking one. `eps` nudges top/bottom off perfectly vertical —
   * OrbitControls' polar angle has a singularity looking straight down the
   * world Y axis, where a tiny numerical wobble can otherwise make the
   * view snap to a wrong azimuth on the very next drag.
   */
  function setView(preset: ViewPreset) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const fit = fitRef.current;
    if (!camera || !controls || !fit) return;
    const { center, maxDim } = fit;
    const d = maxDim * 1.4;
    const eps = maxDim * 0.001;
    const eye = maxDim * 0.25; // eye-level lift for the side elevations, so they don't look like they're skimming the floor
    const positions: Record<ViewPreset, THREE.Vector3> = {
      top: new THREE.Vector3(center.x + eps, center.y + d, center.z + eps),
      bottom: new THREE.Vector3(center.x + eps, center.y - d, center.z + eps),
      front: new THREE.Vector3(center.x, center.y + eye, center.z + d),
      back: new THREE.Vector3(center.x, center.y + eye, center.z - d),
      left: new THREE.Vector3(center.x - d, center.y + eye, center.z),
      right: new THREE.Vector3(center.x + d, center.y + eye, center.z),
      iso: new THREE.Vector3(center.x + maxDim * 0.9, center.y + maxDim * 0.75, center.z + maxDim * 0.9),
    };
    camera.position.copy(positions[preset]);
    controls.target.copy(center);
    controls.update();
    setViewMenuOpen(false);
  }

  /** Repaints one room's floor with a different tile/paint finish — swaps that region mesh's material live, no scene rebuild. */
  function applyFloorFinish(regionId: string, finishId: string) {
    const region = floorRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;
    const mesh = region.object;
    const oldMaterial = mesh.material as THREE.MeshStandardMaterial;
    const newMaterial = buildFloorFinishMaterial(finishId);
    if (newMaterial.map) {
      const rep = Math.max(1, Math.round(Math.sqrt(region.areaM2) / 0.6));
      newMaterial.map.repeat.set(rep, rep);
    }
    mesh.material = newMaterial;
    mesh.userData = { ...mesh.userData, finishId };
    oldMaterial.map?.dispose();
    oldMaterial.dispose();
    setPaintPanel((p) => (p && p.regionId === regionId ? { ...p, finishId } : p));
  }

  /** Renders one frame at a given resolution, off the live canvas, and returns a PNG data URL — used by both the high-res download and the print layout below. */
  function renderSnapshotDataUrl(camera: THREE.Camera, width: number, height: number, background: THREE.ColorRepresentation = 0xf3f1ea): string | null {
    const scene = sceneRef.current;
    if (!scene) return null;
    const prevBackground = scene.background;
    scene.background = new THREE.Color(background);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");
    renderer.dispose();
    scene.background = prevBackground;
    return dataUrl;
  }

  /** High-quality PNG of exactly what's on screen right now, at well past screen resolution — "render option ... download its PNG file". */
  function exportHighResPNG() {
    const camera = cameraRef.current;
    if (!camera) return;
    setRendering(true);
    try {
      const width = 2400;
      const height = Math.round(width / camera.aspect);
      const hiCam = camera.clone();
      hiCam.aspect = width / height;
      hiCam.updateProjectionMatrix();
      const dataUrl = renderSnapshotDataUrl(hiCam, width, height);
      if (dataUrl) downloadDataUrl(dataUrl, `${slug(modelName)}.png`);
    } finally {
      setRendering(false);
    }
  }

  /**
   * A clean, centered, straight-down PLAN print — a dedicated one-off
   * orthographic camera (not the live perspective one) framed on the WHOLE
   * building, not just the focused cluster, since a print is meant to
   * capture the full layout the way a real floor-plan printout would, and
   * an orthographic projection is what keeps parallel walls parallel with
   * no perspective distortion, matching how a printed plan is expected to
   * look. Opens the image in a new tab and triggers the browser's own
   * print dialog — no server-side PDF step needed.
   */
  function printLayout() {
    const group = sceneGroupRef.current;
    if (!group) return;
    setRendering(true);
    try {
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const span = Math.max(size.x, size.z, 1) * 1.08; // small margin so walls aren't flush with the page edge
      const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, Math.max(size.y, 1) * 4 + span);
      camera.position.set(center.x, box.max.y + span, center.z);
      camera.lookAt(center);
      camera.up.set(0, 0, -1); // plan convention: "up" on the page is -Z, not the camera's forward axis
      camera.updateProjectionMatrix();
      const dataUrl = renderSnapshotDataUrl(camera, 1600, 1600, 0xffffff);
      if (dataUrl) openPrintWindow(dataUrl, modelName);
    } finally {
      setRendering(false);
    }
  }

  function downloadDataUrl(dataUrl: string, filename: string) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
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
      {hasSourceDrawing && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setShowDrawing((s) => !s)} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-slate-200">
            <Icon name="grid" className="h-3.5 w-3.5" /> {showDrawing ? "Hide source drawing" : "Compare with source drawing"}
          </button>
        </div>
      )}
      <div className={hasSourceDrawing && showDrawing ? "grid gap-3 md:grid-cols-2" : ""}>
        {hasSourceDrawing && showDrawing && (
          <div style={{ height: 420 }}>
            <SourceDrawing2D entities={entities} />
          </div>
        )}
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
          <div className="absolute left-2 top-2">
            <button
              type="button"
              onClick={() => setViewMenuOpen((o) => !o)}
              aria-label="Choose view"
              className="flex h-10 items-center gap-1.5 rounded-lg bg-white/90 px-3 text-xs font-medium text-foreground shadow active:bg-white"
            >
              <Icon name="cube" className="h-4 w-4" /> Views
            </button>
            {viewMenuOpen && (
              <div className="mt-1 grid w-40 grid-cols-2 gap-1 rounded-lg bg-white/95 p-1.5 shadow">
                {(
                  [
                    ["iso", "Isometric"],
                    ["top", "Top"],
                    ["bottom", "Bottom"],
                    ["front", "Front"],
                    ["back", "Back"],
                    ["left", "Left"],
                    ["right", "Right"],
                  ] as const
                ).map(([preset, label]) => (
                  <button key={preset} type="button" onClick={() => setView(preset)} className="rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-muted">
        Drag to orbit, pinch or use the +/− buttons to zoom. &quot;Views&quot; jumps to a standard top/front/side view. Tap a room&apos;s floor to change its tile or paint.
        {hasSourceDrawing && " The source drawing panel is plotted from the exact same measured entities as the 3D model — not the original DWG/DXF file itself."}
      </p>

      {paintPanel && (
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{paintPanel.roomLabel ?? "Room"}</p>
              <p className="text-xs text-muted">{paintPanel.areaM2.toFixed(1)} m² floor</p>
            </div>
            <button type="button" onClick={() => setPaintPanel(null)} aria-label="Close" className="rounded p-1 text-muted hover:bg-slate-100">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {FLOOR_FINISHES.map((finish) => (
              <button
                key={finish.id}
                type="button"
                onClick={() => applyFloorFinish(paintPanel.regionId, finish.id)}
                aria-label={finish.label}
                title={finish.label}
                className={`flex flex-col items-center gap-1 rounded-lg p-1.5 ${finish.id === paintPanel.finishId ? "ring-2 ring-offset-1" : ""}`}
                style={finish.id === paintPanel.finishId ? { ["--tw-ring-color" as string]: "var(--foreground)" } : undefined}
              >
                <span className="block h-8 w-8 rounded-full border border-black/10" style={{ backgroundColor: finish.swatch }} />
                <span className="text-center text-[10px] leading-tight text-muted">{finish.label.split(" — ")[1] ?? finish.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={exportHighResPNG} disabled={rendering} className="btn btn-secondary">
          <Icon name="camera" className="h-4 w-4" /> {rendering ? "Rendering…" : "Render high-res PNG"}
        </button>
        <button type="button" onClick={printLayout} disabled={rendering} className="btn btn-secondary">
          <Icon name="printer" className="h-4 w-4" /> Print floor plan
        </button>
      </div>

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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Opens a new tab with the rendered plan centered on the page and immediately prompts the browser's print dialog — no server-side PDF step, just the browser's own "print/save as PDF" flow. */
function openPrintWindow(dataUrl: string, modelName: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html>
<html>
<head>
<title>${escapeHtml(modelName)} — floor plan</title>
<style>
  @page { margin: 12mm; }
  html, body { margin: 0; height: 100%; background: #fff; }
  .wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100%; padding: 16px; box-sizing: border-box; }
  img { max-width: 100%; max-height: 90vh; object-fit: contain; }
  .cap { margin-top: 10px; font: 13px system-ui, sans-serif; color: #444; text-align: center; }
</style>
</head>
<body>
  <div class="wrap">
    <img src="${dataUrl}" alt="${escapeHtml(modelName)} floor plan" onload="window.focus(); window.print();" />
    <div class="cap">${escapeHtml(modelName)} — approximate 3D representation generated from the CAD drawing</div>
  </div>
</body>
</html>`);
  win.document.close();
}
