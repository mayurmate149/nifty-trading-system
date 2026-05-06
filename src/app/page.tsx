import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-vz-body px-6 py-12">
      <div className="max-w-lg text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vz-muted">Options · Nifty · Bank Nifty</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Nifty Trading Assistant
        </h1>
        <p className="mt-4 text-balance text-vz-muted">
          Rule-based options trading for Indian indices. Connect your broker and trade with structure.
        </p>
      </div>
      <Link
        href="/login"
        className="inline-flex rounded-xl bg-vz-primary px-10 py-3.5 text-sm font-semibold text-white shadow-lg shadow-vz-primary/30 transition hover:bg-vz-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vz-primary"
      >
        Sign in with 5paisa
      </Link>
    </div>
  );
}
