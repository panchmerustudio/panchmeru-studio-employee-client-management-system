/**
 * Regression check for src/lib/dxf/from-dwg.ts — the DWG-to-IDxf field
 * reshaping layer. Runs against synthetic DwgDatabaseLike fixtures (no WASM
 * needed — dwgDatabaseToIDxf is pure data reshaping), same pattern as
 * scripts/test-dxf-units.ts.
 *
 * Main case this guards: LWPOLYLINE's DWG-internal "closed" bit is 512, NOT
 * bit 1 as plain DXF group-70 semantics (and POLYLINE2D/3D) use — confirmed
 * against libredwg's own dwg.h ("512 closed, 128 plinegen, 4 constwidth, ...
 * 32 has_widths" — flag multiplexes "which optional field is present" bits
 * for LWPOLYLINE's binary encoding, unlike POLYLINE2D/3D's fixed layout).
 * Found by re-investigating a real file (MANPREET_SINGH_ELEVATION.dwg)
 * whose window/door opening rectangles are drawn as closed 4-vertex
 * LWPOLYLINEs relying on this flag bit (not a duplicated closing vertex) —
 * with the wrong bit, every one of them silently read as "open" and was
 * dropped by classify.ts's extractClosedPolylines, undetected until this
 * file existed to test dwgDatabaseToIDxf in isolation.
 *
 * Run with: npx tsx scripts/test-dwg-import.ts
 */
import { dwgDatabaseToIDxf, type DwgDatabaseLike } from "../src/lib/dxf/from-dwg";

function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
}

// --- LWPOLYLINE closed-bit (512, not 1) ---
{
  const db: DwgDatabaseLike = {
    tables: {
      BLOCK_RECORD: {
        entries: [
          {
            name: "*Model_Space",
            entities: [
              {
                type: "LWPOLYLINE",
                layer: "door and window",
                flag: 512, // real value seen on a genuinely-closed rectangle in the reference file
                vertices: [
                  { x: 0, y: 0 },
                  { x: 900, y: 0 },
                  { x: 900, y: 2100 },
                  { x: 0, y: 2100 },
                ],
              },
              {
                type: "LWPOLYLINE",
                layer: "door and window",
                flag: 0, // a genuinely open partial outline in the same file
                vertices: [
                  { x: 2000, y: 0 },
                  { x: 2900, y: 0 },
                  { x: 2900, y: 2100 },
                ],
              },
              {
                type: "LWPOLYLINE",
                layer: "door and window",
                flag: 1, // bit 1 alone (dxf-spec "closed" for a plain LWPOLYLINE) must NOT be read as closed
                vertices: [
                  { x: 4000, y: 0 },
                  { x: 4900, y: 0 },
                  { x: 4900, y: 2100 },
                  { x: 4000, y: 2100 },
                ],
              },
              {
                type: "LWPOLYLINE",
                layer: "door and window",
                flag: 512 | 128 | 4, // closed plus other real-world present-field bits (plinegen, constwidth) still reads as closed
                vertices: [
                  { x: 6000, y: 0 },
                  { x: 6900, y: 0 },
                  { x: 6900, y: 2100 },
                  { x: 6000, y: 2100 },
                ],
              },
            ],
          },
        ],
      },
    },
  };
  const dxf = dwgDatabaseToIDxf(db);
  const polys = (dxf.entities ?? []) as { shape?: boolean }[];
  check("LWPOLYLINE with flag=512 (the real 'closed' bit) reads as shape=true", polys[0]?.shape === true);
  check("LWPOLYLINE with flag=0 (genuinely open) reads as shape=false", polys[1]?.shape === false);
  check("LWPOLYLINE with only bit 1 set (DXF's generic closed bit, NOT LWPOLYLINE's real bit) reads as shape=false — bit 1 means something else entirely for this entity type", polys[2]?.shape === false);
  check("LWPOLYLINE with flag=512 combined with other real present-field bits (128 plinegen, 4 constwidth) still reads as shape=true", polys[3]?.shape === true);
}

// --- POLYLINE2D/3D closed-bit (1, matching DXF group-70 semantics) ---
{
  const db: DwgDatabaseLike = {
    tables: {
      BLOCK_RECORD: {
        entries: [
          {
            name: "*Model_Space",
            entities: [
              { type: "POLYLINE2D", layer: "A-WALL", flag: 1, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }] },
              { type: "POLYLINE2D", layer: "A-WALL", flag: 0, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }] },
              { type: "POLYLINE3D", layer: "A-WALL", flag: 1, vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }] },
            ],
          },
        ],
      },
    },
  } as unknown as DwgDatabaseLike;
  const dxf = dwgDatabaseToIDxf(db);
  const polys = (dxf.entities ?? []) as { type?: string; shape?: boolean }[];
  check("POLYLINE2D with flag=1 reads as shape=true (unlike LWPOLYLINE, bit 1 really is closed here)", polys[0]?.shape === true);
  check("POLYLINE2D with flag=0 reads as shape=false", polys[1]?.shape === false);
  check("POLYLINE3D with flag=1 reads as shape=true", polys[2]?.shape === true);
  check('POLYLINE2D/3D are both remapped to the generic "POLYLINE" type classify.ts expects', polys.every((p) => p.type === "POLYLINE"));
}

// --- Other established field-name/unit reshaping this file documents ---
{
  const db: DwgDatabaseLike = {
    tables: {
      BLOCK_RECORD: {
        entries: [
          {
            name: "*Model_Space",
            entities: [
              { type: "LINE", layer: "A-WALL", startPoint: { x: 0, y: 0 }, endPoint: { x: 1000, y: 0 } },
              { type: "INSERT", layer: "A-DOOR", insertionPoint: { x: 500, y: 500 }, rotation: Math.PI / 2 },
              { type: "MTEXT", layer: "0", insertionPoint: { x: 10, y: 20 }, text: "GROUND FLOOR PLAN" },
            ],
          },
        ],
      },
    },
  } as unknown as DwgDatabaseLike;
  const dxf = dwgDatabaseToIDxf(db);
  const [line, insert, mtext] = dxf.entities as unknown as { vertices?: { x: number; y: number }[]; position?: { x: number; y: number }; rotation?: number }[];
  check("LINE startPoint/endPoint reshaped into a vertices pair", line?.vertices?.[0]?.x === 0 && line?.vertices?.[1]?.x === 1000);
  check("INSERT rotation converted from radians to degrees (π/2 → 90)", Math.abs((insert?.rotation ?? -1) - 90) < 1e-9);
  check("INSERT insertionPoint reshaped into `position`", insert?.position?.x === 500 && insert?.position?.y === 500);
  check("MTEXT insertionPoint reshaped into `position`", mtext?.position?.x === 10 && mtext?.position?.y === 20);
}

// --- Modelspace-only entity reading (ignores stray top-level db.entities / paper-space) ---
{
  const db: DwgDatabaseLike = {
    entities: [{ type: "LINE", layer: "STRAY-PAPERSPACE", startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } }],
    tables: {
      BLOCK_RECORD: {
        entries: [{ name: "*Model_Space", entities: [{ type: "LINE", layer: "REAL", startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } }] }],
      },
    },
  };
  const dxf = dwgDatabaseToIDxf(db);
  check("modelSpaceEntities reads from *Model_Space's own block record, not the stray top-level db.entities list", dxf.entities?.length === 1 && (dxf.entities?.[0] as unknown as { layer?: string })?.layer === "REAL");
}
