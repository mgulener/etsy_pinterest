import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "./login/actions";
import { isAdminSessionValid } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pinterest Automation",
  description: "Etsy to Pinterest automation dashboard"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isAuthenticated = await isAdminSessionValid().catch(() => false);

  return (
    <html lang="en">
      <body>
        {isAuthenticated ? (
          <header className="app-header">
            <Link href="/dashboard" className="brand">
              Pinterest Automation
            </Link>
            <nav>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/listings">Listings</Link>
              <Link href="/queue">Queue</Link>
              <Link href="/pins">Pins</Link>
            </nav>
            <form action={logoutAction}>
              <button className="ghost-button" type="submit">
                Sign out
              </button>
            </form>
          </header>
        ) : null}
        {children}
      </body>
    </html>
  );
}
