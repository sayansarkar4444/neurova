"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  getCurrentUserFromStorage,
  loginWithEmail,
  signupWithEmail,
} from "@/lib/auth";

type AuthMode = "login" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const existingUser = getCurrentUserFromStorage();
    if (existingUser) {
      router.replace("/");
    }
  }, [router]);

  const title = useMemo(
    () => (mode === "login" ? "Welcome Back" : "Create Account"),
    [mode]
  );

  const submitLabel = mode === "login" ? "Login" : "Signup";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) return;

    setIsBusy(true);
    setError(null);

    const result =
      mode === "login"
        ? loginWithEmail(email, password)
        : signupWithEmail(email, password);

    if (!result.ok) {
      setError(result.error);
      setIsBusy(false);
      return;
    }

    router.replace("/");
  };

  return (
    <div className="min-h-screen bg-[#0B0F2B] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-4">
        <div className="w-full rounded-2xl border border-white/12 bg-white/[0.03] p-6 shadow-[0_18px_45px_rgba(2,8,23,0.42)]">
          <div className="mb-5 flex rounded-xl border border-white/12 bg-white/[0.02] p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`h-9 flex-1 rounded-lg text-sm font-semibold transition ${
                mode === "login"
                  ? "bg-cyan-300/85 text-slate-950"
                  : "text-slate-300 hover:bg-white/[0.06]"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className={`h-9 flex-1 rounded-lg text-sm font-semibold transition ${
                mode === "signup"
                  ? "bg-cyan-300/85 text-slate-950"
                  : "text-slate-300 hover:bg-white/[0.06]"
              }`}
            >
              Signup
            </button>
          </div>

          <h1 className="text-xl font-semibold text-slate-50">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">
            Access your own Neurova data and continue where you left off.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-11 w-full rounded-xl border border-white/14 bg-white/[0.025] px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="h-11 w-full rounded-xl border border-white/14 bg-white/[0.025] px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
              />
            </label>

            {error ? (
              <p className="rounded-lg border border-rose-300/35 bg-rose-300/[0.12] px-3 py-2 text-sm text-rose-100">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isBusy}
              className={`h-11 w-full rounded-xl border text-sm font-semibold transition ${
                isBusy
                  ? "cursor-not-allowed border-cyan-300/18 bg-cyan-300/45 text-slate-900/70"
                  : "border-cyan-300/35 bg-cyan-300/90 text-slate-950 hover:bg-cyan-200"
              }`}
            >
              {submitLabel}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
