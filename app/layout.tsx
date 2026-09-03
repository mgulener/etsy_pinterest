import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "./login/actions";
import { isAdminSessionValid } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Etsy Social Automation",
  description: "Etsy to social publishing automation dashboard"
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
              Etsy Social Automation
            </Link>
            <nav>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/etsy/listings">Etsy Listings</Link>
              <Link href="/pinterest/queue">Pinterest Queue</Link>
              <Link href="/pinterest/posts">Pinterest Posts</Link>
              <Link href="/instagram/queue">Instagram Queue</Link>
              <Link href="/instagram/posts">Instagram Posts</Link>
              <Link href="/privacy">Privacy</Link>
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
