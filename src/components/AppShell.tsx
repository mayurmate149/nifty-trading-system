"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Radio,
  ScanSearch,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/app/providers/AuthProvider";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/positions", label: "Positions", icon: TrendingUp },
  { href: "/option-chain-live", label: "Option Chain", icon: Radio },
  { href: "/pro-trader", label: "Pro Trader", icon: Zap },
  { href: "/trader-calendar", label: "Calendar", icon: CalendarDays },
  { href: "/auto-scanner", label: "Pro Desk", icon: ScanSearch },
];

const ROUTE_TITLES: Record<string, string> = {
  "/": "Home",
  "/dashboard": "Dashboard",
  "/journal": "Journal",
  "/positions": "Positions",
  "/option-chain-live": "Option Chain",
  "/pro-trader": "Pro Trader",
  "/trader-calendar": "Trader Calendar",
  "/auto-scanner": "Pro Desk",
  "/login": "Sign in",
  "/auth/callback": "Signing in",
  "/backtest": "Backtest",
  "/trade-suggestions": "Trade ideas",
};

function pageTitle(path: string): string {
  if (ROUTE_TITLES[path]) return ROUTE_TITLES[path];
  const base = path.split("?")[0] ?? path;
  const seg = base.split("/").filter(Boolean)[0];
  if (!seg) return "ANVI Trade Engine";
  return seg
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function navActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const title = useMemo(() => pageTitle(pathname), [pathname]);

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  const initial = (user?.clientCode?.charAt(0) ?? "U").toUpperCase();

  return (
    <div className="min-h-screen bg-vz-body text-vz-foreground">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(17rem,88vw)] flex-col border-r border-white/[0.06] bg-vz-sidebar shadow-2xl shadow-black/40 transition-transform duration-200 ease-out lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-vz-primary to-fuchsia-600 text-sm font-black text-white shadow-lg shadow-vz-primary/25">
              A
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold tracking-tight text-white">ANVI</p>
              <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-vz-muted">
                Trade Engine
              </p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-vz-muted">Menu</p>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = navActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/[0.08] text-white shadow-inner"
                    : "text-vz-muted hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-vz-primary" : ""}`} />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-white/[0.06] p-3">
          <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
            <p className="truncate text-xs font-medium text-white" title={user?.clientCode ?? undefined}>
              {user?.clientCode ?? "—"}
            </p>
            <p className="text-[10px] text-vz-muted">Connected account</p>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-col lg:pl-[17rem]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.06] bg-vz-body/90 px-3 backdrop-blur-md sm:h-16 sm:px-4 lg:px-6">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white hover:bg-white/[0.08] lg:hidden"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-white sm:text-lg">{title}</h1>
            <p className="hidden truncate text-xs text-vz-muted sm:block">
              {new Intl.DateTimeFormat("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              }).format(new Date())}{" "}
              · IST
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden max-w-[8rem] truncate rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-vz-muted sm:inline-block">
              {user?.clientCode}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-vz-primary/80 to-fuchsia-600/80 text-xs font-bold text-white sm:hidden">
              {initial}
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-medium text-vz-muted transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
