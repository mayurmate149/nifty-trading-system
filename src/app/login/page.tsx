"use client";

/**
 * Login — Velzon-inspired centered card (no shell when logged out).
 */

export default function LoginPage() {
  const handleLogin = async () => {
    const res = await fetch("/api/v1/auth/redirect-url");
    const { url } = await res.json();
    window.location.href = url;
  };

  return (
    <div className="flex min-h-screen flex-col bg-vz-body lg:flex-row">
      <div className="relative flex flex-[1.1] flex-col justify-end bg-gradient-to-br from-vz-primary/90 via-indigo-900 to-vz-body px-8 pb-12 pt-20 text-white lg:justify-center lg:p-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.12),_transparent_55%)]" />
        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">ANVI Trade Engine</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight lg:text-4xl">
            Trade smarter with a rule-based options engine
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/80">
            Connect 5paisa once. Monitor positions, Greeks, and the tape in one professional workspace.
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-vz-card/80 p-8 shadow-2xl shadow-black/40 backdrop-blur-sm">
          <h2 className="text-xl font-semibold text-white">Welcome back</h2>
          <p className="mt-2 text-sm text-vz-muted">
            Sign in with your 5paisa account to open your dashboard.
          </p>
          <button
            type="button"
            onClick={handleLogin}
            className="mt-8 w-full rounded-lg bg-vz-primary py-3 text-sm font-semibold text-white shadow-lg shadow-vz-primary/25 transition hover:bg-vz-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vz-primary"
          >
            Continue with 5paisa
          </button>
          <p className="mt-6 text-center text-xs leading-relaxed text-vz-muted">
            Your credentials are handled by 5paisa OAuth. We never store your password.
          </p>
        </div>
      </div>
    </div>
  );
}
