"use client";

/**
 * Global Error Boundary
 *
 * Catches unhandled errors in the app and displays a fallback UI.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-100">
        <div className="text-center">
          <h2 className="mb-4 text-2xl font-bold text-red-400">Something went wrong</h2>
          <p className="mb-6 text-gray-400">{error.message}</p>
          <button
            onClick={reset}
            className="rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-500"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
