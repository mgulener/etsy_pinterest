import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TheCozyCedar Social Automation",
  description:
    "TheCozyCedar's private workspace for reviewing and publishing Etsy listing content to connected social accounts."
};

const integrations = [
  {
    name: "Etsy",
    mark: "E",
    description: "Imports listing details and product images from the authorized shop."
  },
  {
    name: "Pinterest",
    mark: "P",
    description: "Prepares approved products for scheduled Pin publishing through OAuth."
  },
  {
    name: "Instagram",
    mark: "I",
    description: "Creates reviewed single-image and carousel posts for the connected account."
  }
];

export default function HomePage() {
  return (
    <main className="public-site">
      <section className="public-hero">
        <div className="public-hero-shade" />
        <header className="public-header">
          <Link href="/" className="public-brand" aria-label="TheCozyCedar Social Automation home">
            <span className="public-brand-mark">TC</span>
            <span>TheCozyCedar</span>
          </Link>
          <nav aria-label="Public navigation">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/login" className="btn btn-light btn-sm px-3">
              Admin sign in
            </Link>
          </nav>
        </header>

        <div className="public-hero-content">
          <p className="public-kicker">Private social publishing workspace</p>
          <h1>TheCozyCedar Social Automation</h1>
          <p>
            A review-first workflow that connects TheCozyCedar&apos;s Etsy catalog
            with its authorized Pinterest and Instagram accounts.
          </p>
          <div className="public-hero-actions">
            <Link href="/login" className="btn btn-light btn-lg px-4">
              Open publishing console
            </Link>
            <Link href="/privacy" className="btn btn-outline-light btn-lg px-4">
              Read privacy policy
            </Link>
          </div>
        </div>
      </section>

      <section className="public-intro" aria-labelledby="workflow-heading">
        <div>
          <p className="public-kicker">Connected workflow</p>
          <h2 id="workflow-heading">One place to review what gets published</h2>
        </div>
        <p>
          Listings are imported from the shop, prepared for each channel, and
          kept in a visible queue so captions, images, and timing can be reviewed
          before publication.
        </p>
      </section>

      <section className="public-integrations" aria-label="Connected platforms">
        {integrations.map((integration) => (
          <article className={`public-integration public-integration-${integration.name.toLowerCase()}`} key={integration.name}>
            <span className="public-integration-mark" aria-hidden="true">
              {integration.mark}
            </span>
            <div>
              <h2>{integration.name}</h2>
              <p>{integration.description}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="public-trust">
        <div>
          <p className="public-kicker">Account control</p>
          <h2>Official authorization, private settings</h2>
        </div>
        <p>
          Platform access uses official OAuth flows. Tokens and account settings
          stay in private server-side storage and are never exposed on this public site.
        </p>
      </section>

      <footer className="public-footer">
        <span>TheCozyCedar Social Automation</span>
        <nav aria-label="Legal navigation">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/data-deletion">Data Deletion</Link>
          <a href="mailto:cfapparel2025@gmail.com">Contact</a>
        </nav>
      </footer>
    </main>
  );
}
