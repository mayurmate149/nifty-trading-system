"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/providers/AuthProvider";

const NAV_ITEMS = [
  { href: "/dashboard", label: "🏠 Dashboard" },
  { href: "/positions", label: "📊 Positions" },
  { href: "/analytics", label: "📈 Analytics" },
  { href: "/auto-scanner", label: "🔍 Scanner" },
  { href: "/scalp-ai", label: "🤖 Scalp AI" },
  { href: "/trade-suggestions", label: "🎯 Trades" },
  { href: "/backtest", label: "🔬 Backtest" },
];


export function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, loading, logout } = useAuth();

  if (loading) return null;
  if (!isAuthenticated) return null;

  return (
    <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-black text-white shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/40 transition">
              A
            </span>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                ANVI
              </span>
              <span className="text-[9px] tracking-widest text-gray-500 uppercase">Trade Engine</span>
            </div>
          </Link>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`text-sm font-medium transition ${
                pathname === item.href
                  ? "text-blue-400"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">{user?.clientCode}</span>
          <button
            onClick={logout}
            className="rounded bg-gray-800 px-3 py-1 text-xs text-gray-400 hover:bg-gray-700"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}
