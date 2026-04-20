"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

/**
 * Redirects to /login if session is expired or user is not authenticated.
 * Usage: Place <RequireAuth /> at the top of your layout or page.
 */
export function RequireAuth() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [loading, isAuthenticated, router]);

  return null;
}
