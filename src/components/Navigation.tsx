"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/live", label: "Live", icon: "⚡" },
  { href: "/trades", label: "Obchody", icon: "📈" },
  { href: "/settings", label: "Nastavení", icon: "⚙️" },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--card-border)] bg-[var(--card)]">
      <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-1">
        <Link href="/" className="font-bold text-lg mr-6 tracking-tight">
          <span className="text-[var(--accent)]">Binance</span> Scalper
        </Link>

        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`
                px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${active
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--background)]"
                }
              `}
            >
              {link.icon} {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
