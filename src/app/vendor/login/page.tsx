"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function VendorLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/vendor-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign-in failed. Please try again.");
        return;
      }
      router.push("/vendor");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-ink text-xl font-bold text-white">PS</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Vendor Portal</h1>
          <p className="mt-1 text-sm text-muted">Drawings for your trade, on your assigned projects — in-app only.</p>
        </div>

        <div className="card p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Password</label>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
