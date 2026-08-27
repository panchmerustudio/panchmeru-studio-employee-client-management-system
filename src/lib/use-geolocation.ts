"use client";

export type GeoResult = { latitude: number; longitude: number; accuracy: number };

/** Wraps the Geolocation API with the clear, specific error copy section 83 asks for. */
export function getCurrentPosition(highAccuracy = true): Promise<GeoResult> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location isn't available on this device/browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error("Location permission is required for check-in. Please allow location access and try again."));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error("Getting your location is taking too long. Move to an open area and try again."));
        } else {
          reject(new Error("Couldn't get your location. Please try again."));
        }
      },
      { enableHighAccuracy: highAccuracy, timeout: 15000, maximumAge: 0 }
    );
  });
}

/**
 * Continuous GPS stream for the live boundary walk (survey capture) — unlike
 * getCurrentPosition() above (one-shot, used for check-in/tap-to-add-point),
 * this keeps reporting fixes until stopped. Every raw fix is handed to
 * onUpdate (for the live accuracy readout / map dot) — point-gating
 * (shouldCapturePoint in lib/geo.ts) is applied by the caller, not here, so
 * the live UI always reflects the freshest fix even between kept points.
 * Returns a stop() function; call it on unmount/pause/finish.
 */
export function watchPosition(onUpdate: (pos: GeoResult) => void, onError: (err: Error) => void, highAccuracy = true): () => void {
  if (!("geolocation" in navigator)) {
    onError(new Error("Location isn't available on this device/browser."));
    return () => {};
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) => onUpdate({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onError(new Error("Location permission is required to measure the plot. Please allow location access and try again."));
      } else if (err.code === err.TIMEOUT) {
        onError(new Error("Getting your location is taking too long. Move to an open area."));
      } else {
        onError(new Error("Lost your location fix. Move to an open area — capture will resume automatically."));
      }
    },
    { enableHighAccuracy: highAccuracy, timeout: 20000, maximumAge: 0 }
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
