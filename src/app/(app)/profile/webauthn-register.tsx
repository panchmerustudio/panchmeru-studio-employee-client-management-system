"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Icon } from "@/components/icon";

export function WebauthnRegister() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  if (typeof window !== "undefined" && !browserSupportsWebAuthn()) {
    return <p className="text-xs text-muted">Biometric sign-in isn&apos;t supported in this browser.</p>;
  }

  async function register() {
    setBusy(true);
    setMessage(null);
    try {
      const optionsRes = await fetch("/api/auth/webauthn/register-options", { method: "POST" });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options.error);

      const attestation = await startRegistration(options);

      const verifyRes = await fetch("/api/auth/webauthn/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, nickname: navigator.userAgent.slice(0, 40) }),
      });
      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(data.error);
      setMessage({ tone: "success", text: "This device is now registered for biometric sign-in." });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't register this device." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={register} disabled={busy} className="btn btn-secondary">
        <Icon name="check-circle" className="h-4 w-4" /> {busy ? "Registering…" : "Register this device"}
      </button>
      {message && <p className={`mt-2 text-xs ${message.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>}
    </div>
  );
}
