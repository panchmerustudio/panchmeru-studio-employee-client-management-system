/**
 * Adapts a parsed DWG (via @mlightcad/libredwg-web's DwgDatabase — see
 * ../dwg.ts, which does the actual WASM parsing) into the same IDxf-shaped
 * object dxf-parser produces for a DXF file, so classify.ts's whole
 * classification pipeline — already built, tested, and tuned against real
 * plan-view drawings — runs unmodified on either source. This file is pure
 * data reshaping (no WASM, no I/O) so it's independently testable via tsx,
 * same as units.ts.
 *
 * Three real differences between the two formats this has to paper over
 * (found by inspecting real DWG output, not assumed from documentation):
 *  1. Field names differ per entity type: DWG LINE uses startPoint/endPoint
 *     where DXF (and classify.ts) expects a `vertices` pair; DWG INSERT/
 *     MTEXT use `insertionPoint` where DXF uses `position`.
 *  2. DWG angles (INSERT.rotation) are stored in RADIANS — confirmed
 *     against a real file's INSERT rotations (0, π/2, π, 3π/2) — while
 *     DXF's group-code-50 rotation, and everything classify.ts/build-scene
 *     assume, is DEGREES. Left unconverted, a real 90° turn would read as
 *     "1.57 degrees" — i.e. almost no rotation at all — which is exactly
 *     the kind of silent, plausible-looking-but-wrong bug this codebase
 *     has already hit once (the CAD rotationDeg vs. wall-angle mixup).
 *  3. `db.entities` (top-level) is NOT modelspace-only despite its own
 *     doc comment — a real file had 2 stray paper-space entities mixed in
 *     (ownerBlockRecordSoftId pointing at the *Paper_Space block record,
 *     not *Model_Space). Reading modelspace entities from the
 *     *Model_Space block record directly (tables.BLOCK_RECORD.entries)
 *     sidesteps that instead of trusting the flat list.
 */
import type { IDxf, IEntity, IBlock } from "dxf-parser";

// Minimal structural shape of what we actually read off a DwgDatabase —
// not importing the real `DwgDatabase` type here keeps this file free of
// any runtime dependency on @mlightcad/libredwg-web, so a synthetic test
// fixture doesn't need the real WASM package installed to exercise this
// logic (see scripts/test-dwg-import.ts).
type AnyEntity = Record<string, unknown> & { type?: string };
export type DwgDatabaseLike = {
  header?: Record<string, unknown>;
  entities?: AnyEntity[];
  tables?: { BLOCK_RECORD?: { entries?: { name?: string; entities?: AnyEntity[] }[] } };
};

const RAD_TO_DEG = 180 / Math.PI;

function xy(p: unknown): { x: number; y: number } {
  const pt = (p ?? {}) as { x?: number; y?: number };
  return { x: pt.x ?? 0, y: pt.y ?? 0 };
}

/** Reshapes one DWG entity into dxf-parser's field-name conventions. Unknown/annotation types (HATCH, DIMENSION, LEADER, VIEWPORT, ...) pass through unchanged — classify.ts only ever branches on `.type` for those, never reads their fields. */
function adaptEntity(e: AnyEntity): IEntity {
  switch (e.type) {
    case "LINE":
      return { ...e, vertices: [xy(e.startPoint), xy(e.endPoint)] } as unknown as IEntity;
    case "LWPOLYLINE":
      return { ...e, vertices: ((e.vertices as unknown[]) ?? []).map(xy) } as unknown as IEntity;
    case "POLYLINE2D":
    case "POLYLINE3D":
      // dxf-parser (and classify.ts) only know a single generic "POLYLINE" type.
      return { ...e, type: "POLYLINE", vertices: ((e.vertices as unknown[]) ?? []).map(xy) } as unknown as IEntity;
    case "ARC":
    case "CIRCLE":
      return { ...e, center: xy(e.center) } as unknown as IEntity;
    case "INSERT":
      return { ...e, position: xy(e.insertionPoint), rotation: ((e.rotation as number) ?? 0) * RAD_TO_DEG } as unknown as IEntity;
    case "TEXT":
      return { ...e, startPoint: xy(e.startPoint) } as unknown as IEntity;
    case "MTEXT":
      return { ...e, position: xy(e.insertionPoint) } as unknown as IEntity;
    default:
      return e as unknown as IEntity;
  }
}

function adaptEntities(raw: AnyEntity[] | undefined): IEntity[] {
  return (raw ?? []).map(adaptEntity);
}

/** Real, insertable block definitions only — *Model_Space/*Paper_Space* are pseudo block-records for the drawing's own spaces, never something an INSERT references by name. */
function adaptBlocks(db: DwgDatabaseLike): Record<string, IBlock> {
  const blocks: Record<string, IBlock> = {};
  for (const rec of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (!rec.name || rec.name.startsWith("*")) continue;
    blocks[rec.name] = { entities: adaptEntities(rec.entities), name: rec.name } as unknown as IBlock;
  }
  return blocks;
}

function modelSpaceEntities(db: DwgDatabaseLike): AnyEntity[] {
  const modelSpace = db.tables?.BLOCK_RECORD?.entries?.find((r) => r.name === "*Model_Space");
  return modelSpace?.entities ?? db.entities ?? [];
}

export function dwgDatabaseToIDxf(db: DwgDatabaseLike): IDxf {
  const insunits = db.header?.INSUNITS;
  return {
    header: typeof insunits === "number" ? { $INSUNITS: insunits } : {},
    entities: adaptEntities(modelSpaceEntities(db)),
    blocks: adaptBlocks(db),
    tables: {},
  } as unknown as IDxf;
}
