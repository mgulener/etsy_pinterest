import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "./login/actions";
import { isAdminSessionValid } from "@/lib/auth/session";
import "bootstrap/dist/css/bootstrap.min.css";
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
          <div className="app-shell">
            <aside className="app-sidebar">
              <Link href="/dashboard" className="brand">
                <span className="brand-mark">ES</span>
                <span>
                  Etsy Social
                  <small>Automation</small>
                </span>
              </Link>
              <nav className="sidebar-nav">
                <span className="nav-section">Overview</span>
                <Link href="/dashboard">Dashboard</Link>
                <Link href="/etsy/listings">Etsy Listings</Link>
                <span className="nav-section">Pinterest</span>
                <Link href="/pinterest/queue">Queue</Link>
                <Link href="/pinterest/posts">Published Posts</Link>
                <span className="nav-section">Instagram</span>
                <Link href="/instagram/queue">Queue</Link>
                <Link href="/instagram/posts">Published Posts</Link>
                <span className="nav-section">System</span>
                <Link href="/settings">Settings</Link>
                <Link href="/privacy">Privacy</Link>
              </nav>
            </aside>
            <div className="app-workspace">
              <header className="app-topbar">
                <div>
                  <strong>Publishing Console</strong>
                  <span>Manage Etsy listings and social queues</span>
                </div>
                <form action={logoutAction}>
                  <button className="ghost-button btn btn-outline-secondary" type="submit">
                    Sign out
                  </button>
                </form>
              </header>
              {children}
            </div>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
