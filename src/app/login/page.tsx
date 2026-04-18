"use client";

/**
 * Login Page
 *
 * Phase 1: SSO button that redirects to 5paisa OAuth URL.
 */

export default function LoginPage() {
  const handleLogin = async () => {
    // Fetch the OAuth redirect URL from our API
    const res = await fetch("/api/v1/auth/redirect-url");
    const { url } = await res.json();
    window.location.href = url;
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8 shadow-xl">
        <h1 className="mb-2 text-2xl font-bold">Welcome Back</h1>
        <p className="mb-8 text-gray-400">
          Sign in with your 5paisa account to access your trading dashboard.
        </p>
        <button
          onClick={handleLogin}
          className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500"
        >
          🔐 Login with 5paisa
        </button>
        <p className="mt-4 text-center text-xs text-gray-500">
          Your credentials are handled securely by 5paisa. We never store your password.
        </p>
      </div>
    </div>
  );
}
