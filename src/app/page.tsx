import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-4xl font-bold tracking-tight">
        🚀 Nifty Trading Assistant
      </h1>
      <p className="max-w-xl text-center text-gray-400">
        Rule-based options trading assistant for Nifty/BankNifty.
        Connect your 5paisa account to get started.
      </p>
      <Link
        href="/login"
        className="rounded-lg bg-blue-600 px-8 py-3 font-semibold text-white transition hover:bg-blue-500"
      >
        Login with 5paisa →
      </Link>
    </div>
  );
}
