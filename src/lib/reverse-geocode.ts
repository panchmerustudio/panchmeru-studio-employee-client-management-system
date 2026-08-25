/**
 * Best-effort client-side reverse geocoding via OpenStreetMap's free Nominatim
 * API (no API key, no billing). This turns a raw GPS fix into a human-readable
 * address so an owner reviewing attendance/site-visit records sees "12 Model
 * Town, Ludhiana" instead of just a lat/long pair.
 *
 * This must NEVER block or fail a check-in/out: Nominatim is a shared free
 * service with light rate limits, so any failure, timeout, or slow response
 * here just means the address is left blank — the lat/long/accuracy (already
 * captured separately) remain the source of truth either way.
 */
export async function reverseGeocode(lat: number, lng: number, timeoutMs = 4000): Promise<string | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.display_name === "string" ? data.display_name : null;
  } catch {
    return null;
  }
}
