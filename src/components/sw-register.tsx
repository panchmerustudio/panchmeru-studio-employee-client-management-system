"use client";

import { useEffect } from "react";

/** Registers the service worker so the app is installable and the shell loads offline (section 56/63). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // non-fatal: app still works online without the service worker
      });
    }
  }, []);
  return null;
}
