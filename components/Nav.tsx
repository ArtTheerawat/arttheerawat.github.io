"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, ListTodo, CalendarDays, CandlestickChart, Headphones, BookOpen, Activity, Bot, BarChart3, type LucideIcon } from "lucide-react";
import AuthStatus from "./AuthStatus";
import NotificationCenter from "./NotificationCenter";
import GlobalSearch from "./GlobalSearch";

type NavLink = { href: string; label: string; Icon: LucideIcon };

const BASIC_LINKS: NavLink[] = [
  { href: "/", label: "TheeDeck", Icon: Layers },
];

/* Primary: learning-related, always pinned up top. */
const PRIMARY_LINKS: NavLink[] = [
  { href: "/today", label: "งานวันนี้", Icon: ListTodo },
  { href: "/classroom", label: "คลาสรูม", Icon: BookOpen },
  { href: "/assistant", label: "ผู้ช่วย", Icon: Bot },
  { href: "/schedule", label: "ตาราง", Icon: CalendarDays },
];

/* Secondary: personal / support tools, visually separated. */
const SECONDARY_LINKS: NavLink[] = [
  { href: "/trading", label: "เทรด", Icon: CandlestickChart },
  { href: "/dictation", label: "ฝึกฟัง", Icon: Headphones },
  { href: "/system", label: "สถานะ", Icon: Activity },
  { href: "/analytics", label: "สถิติ", Icon: BarChart3 },
];

function NavLinkItem({ l }: { l: NavLink }) {
  const pathname = usePathname();
  const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
  const Icon = l.Icon;
  return (
    <Link href={l.href} className={active ? "on" : ""} aria-current={active ? "page" : undefined}>
      <Icon className="nav-ico" aria-hidden="true" />
      {l.label}
    </Link>
  );
}

export default function Nav() {
  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        {[...BASIC_LINKS, ...PRIMARY_LINKS, ...SECONDARY_LINKS].map((l) =>
          l.href === "/schedule" ? (
            <Fragment key={l.href}>
              <NavLinkItem l={l} />
              <span className="nav-sep" role="separator" aria-hidden="true" />
            </Fragment>
          ) : (
            <NavLinkItem key={l.href} l={l} />
          )
        )}
        <span className="nav-auth">
          <GlobalSearch />
          <NotificationCenter />
          <AuthStatus />
        </span>
      </div>
    </nav>
  );
}