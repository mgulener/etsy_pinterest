import Link from "next/link";

export function PublicLegalHeader() {
  return (
    <header className="public-legal-header">
      <Link href="/" className="public-brand">
        <span className="public-brand-mark">TC</span>
        <span>TheCozyCedar</span>
      </Link>
      <Link href="/login" className="btn btn-outline-secondary btn-sm">
        Admin sign in
      </Link>
    </header>
  );
}

export function PublicLegalFooter() {
  return (
    <footer className="public-footer public-legal-footer">
      <span>TheCozyCedar Social Automation</span>
      <nav aria-label="Legal navigation">
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/terms">Terms of Service</Link>
        <Link href="/data-deletion">Data Deletion</Link>
      </nav>
    </footer>
  );
}
