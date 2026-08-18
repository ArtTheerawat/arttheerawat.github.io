"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, ListTodo, CalendarDays, CandlestickChart, Headphones, BookOpen, type LucideIcon } from "lucide-react";
import AuthStatus from "./AuthStatus";
import NotificationCenter from "./NotificationCenter";

type NavLink = { href: string; label: string; Icon: LucideIcon };

const LINKS: NavLink[] = [
  { href: "/", label: "TheeDeck", Icon: Layers },
  { href: "/today", label: "งานวันนี้", Icon: ListTodo },
  { href: "/classroom", label: "คลาสรูม", Icon: BookOpen },
  { href: "/schedule", label: "ตาราง", Icon: CalendarDays },
  { href: "/trading", label: "เทรด", Icon: CandlestickChart },
  { href: "/dictation", label: "ฝึกฟัง", Icon: Headphones },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          const Icon = l.Icon;
          return (
            <Link key={l.href} href={l.href} className={active ? "on" : ""} aria-current={active ? "page" : undefined}>
              <Icon className="nav-ico" aria-hidden="true" />
              {l.label}
            </Link>
          );
        })}
        <span className="nav-auth">
                  <NotificationCenter />
                  <AuthStatus />
                </span>
      </div>
    </nav>
  );
}