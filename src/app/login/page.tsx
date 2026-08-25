"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"password" | "biometric" | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    if (browserSupportsWebAuthn()) {
      platformAuthenticatorIsAvailable().then(setBiometricAvailable);
    }
  }, []);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading("password");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, deviceName: navigator.userAgent.slice(0, 60) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign-in failed. Please try again.");
        return;
      }
      router.push("/home");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(null);
    }
  }

  async function handleBiometricLogin() {
    setError(null);
    setLoading("biometric");
    try {
      const optionsRes = await fetch("/api/auth/webauthn/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email || undefined }),
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options.error || "Couldn't start biometric sign-in.");

      const assertion = await startAuthentication(options);

      const verifyRes = await fetch("/api/auth/webauthn/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Biometric sign-in failed.");
      router.push("/home");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Biometric sign-in failed.";
      if (message.toLowerCase().includes("not allowed")) {
        setError("Biometric sign-in was cancelled.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-ink text-xl font-bold text-white">
            PS
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Panchmeru Studio</h1>
          <p className="mt-1 text-sm text-muted">Studio operations, in your pocket.</p>
        </div>

        <div className="card p-6 shadow-sm">
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Email or mobile</label>
              <input
                className="input"
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@panchmeru.studio"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Password</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading !== null} className="btn btn-primary w-full">
              {loading === "password" ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {biometricAvailable && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
                <div className="h-px flex-1 bg-border" />
                or
                <div className="h-px flex-1 bg-border" />
              </div>
              <button onClick={handleBiometricLogin} disabled={loading !== null} className="btn btn-secondary w-full">
                {loading === "biometric" ? "Verifying…" : "🔒 Sign in with Face ID / Fingerprint"}
              </button>
            </>
          )}
        </div>

        {process.env.NODE_ENV !== "production" && (
          <p className="mt-6 text-center text-xs text-muted">
            Demo password for all seed accounts: <span className="font-mono">Panchmeru@123</span>
          </p>
        )}
      </div>
    </div>
  );
}
