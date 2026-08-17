"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthStatus from "./AuthStatus";

const LINKS = [
  { href: "/", label: "🃏 TheeDeck" },
  { href: "/today", label: "📚 งานวันนี้" },
  { href: "/schedule", label: "🗓️ ตาราง" },
  { href: "/trading", label: "📊 เทรด" },
  { href: "/dictation", label: "🔊 ฝึกฟัง" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        {LINKS.map((l) => {
                  const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
                  return (
                    <Link key={l.href} href={l.href} className={active ? "on" : ""} aria-current={active ? "page" : undefined}>
                                          {l.label}
                                        </Link>
                  );
                })}
                <span className="nav-auth">
                  <AuthStatus />
                </span>
              </div>
            </nav>
  );
}