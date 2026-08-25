"use client";

/**
 * Section 56: construction sites have poor connectivity. Anything the
 * user captures — a check-in, a site report, a photo, a boundary point —
 * must never be silently lost. This is a tiny durable queue backed by
 * IndexedDB: writes go in immediately (so the UI can say "Saved" right
 * away), a background loop retries them against the network, and each
 * item's status (`pending` / `synced` / `failed`) is what the UI badges
 * as PENDING SYNC / SYNCED.
 */

export type QueueItem = {
  id: string;
  url: string;
  method: "POST" | "PATCH";
  body: unknown;
  createdAt: number;
  status: "pending" | "synced" | "failed";
  label: string; // human-readable, e.g. "Site report — Sharma Residence"
  attempts: number;
  lastError?: string;
};

const DB_NAME = "panchmeru-offline";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(item: Omit<QueueItem, "status" | "attempts" | "createdAt">): Promise<void> {
  const db = await openDb();
  const full: QueueItem = { ...item, status: "pending", attempts: 0, createdAt: Date.now() };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  void processQueue();
}

export async function listQueue(): Promise<QueueItem[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as QueueItem[]).sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

async function updateItem(item: QueueItem) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let processing = false;

export async function processQueue(): Promise<void> {
  if (typeof indexedDB === "undefined" || processing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  processing = true;
  try {
    const items = await listQueue();
    for (const item of items.filter((i) => i.status !== "synced")) {
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.body),
        });
        if (res.ok) {
          await updateItem({ ...item, status: "synced" });
        } else {
          const data = await res.json().catch(() => ({}));
          await updateItem({ ...item, status: "failed", attempts: item.attempts + 1, lastError: data.error || `HTTP ${res.status}` });
        }
      } catch {
        await updateItem({ ...item, status: "pending", attempts: item.attempts + 1, lastError: "Network unavailable" });
        break; // stop the batch — we're almost certainly offline
      }
    }
  } finally {
    processing = false;
  }
}

export function startOfflineSync() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => void processQueue());
  const interval = setInterval(() => void processQueue(), 20000);
  void processQueue();
  return () => clearInterval(interval);
}

export async function pendingCount(): Promise<number> {
  const items = await listQueue();
  return items.filter((i) => i.status === "pending" || i.status === "failed").length;
}
