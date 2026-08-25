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
