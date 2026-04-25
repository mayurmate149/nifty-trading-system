"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./providers/AuthProvider";
import { MarketTicksProvider } from "@/contexts/MarketTicksContext";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10 * 1000, // 10 seconds
            // Avoid duplicating /positions, /indicators, /auto-exit on every tab focus
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MarketTicksProvider>{children}</MarketTicksProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
