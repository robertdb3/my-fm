import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { LogoutButton } from "../src/components/logout-button";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <strong>Music Cable Box</strong>
          <nav>
            <Link href="/stations">Stations</Link>
            <Link href="/radio">Radio</Link>
            <Link href="/settings">Settings</Link>
            <LogoutButton />
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
