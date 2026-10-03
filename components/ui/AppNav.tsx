"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { label: "Cases", href: "/cases" },
  { label: "Testing", href: "/test" },
  { label: "Account", href: "/account" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="rok-nav">
      <Link className="rok-nav__mark" href="/cases">
        3ROK
      </Link>
      <nav aria-label="Primary">
        <ul className="rok-nav__links">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <li key={link.href}>
                <Link
                  className="rok-nav__link eyebrow"
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
