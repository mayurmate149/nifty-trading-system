"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Auth Callback Page
 *
 * Phase 1: Handles redirect from 5paisa OAuth.
 * Extracts requestToken from URL and exchanges it for session.
 */

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const requestToken = searchParams.get("RequestToken");
    if (!requestToken) {
      router.push("/login");
      return;
    }

    // Exchange token with our server
    fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        requestToken,
        redirectUri: window.location.origin + "/auth/callback",
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          router.push("/positions");
        } else {
          router.push("/login?error=auth_failed");
        }
      })
      .catch(() => router.push("/login?error=auth_error"));
  }, [searchParams, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 text-2xl">🔄</div>
        <p className="text-gray-400">Authenticating with 5paisa...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  );
}
