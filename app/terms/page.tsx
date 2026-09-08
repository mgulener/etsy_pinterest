import type { Metadata } from "next";
import { PublicLegalFooter, PublicLegalHeader } from "@/app/components/PublicLegal";

export const metadata: Metadata = {
  title: "Terms of Service | TheCozyCedar Social Automation",
  description: "Terms of service for TheCozyCedar Social Automation."
};

export default function TermsPage() {
  return (
    <main className="public-legal-shell">
      <PublicLegalHeader />
      <article className="public-legal-document">
        <header>
          <p className="public-kicker">Legal</p>
          <h1>Terms of Service</h1>
          <p>Effective September 8, 2026</p>
        </header>

        <section className="legal-section">
          <h2>Purpose</h2>
          <p>
            TheCozyCedar Social Automation is a private operational tool used by
            the shop owner to manage authorized Etsy, Pinterest, and Instagram
            publishing workflows. It is not offered as a public consumer service.
          </p>
        </section>
        <section className="legal-section">
          <h2>Authorized use</h2>
          <p>
            Access is limited to approved administrators. Users must connect only
            accounts they own or are authorized to manage and must comply with
            Etsy, Pinterest, Meta, and other applicable platform terms.
          </p>
        </section>
        <section className="legal-section">
          <h2>Content and publishing</h2>
          <p>
            The administrator remains responsible for product information,
            captions, media selections, schedules, and published content. Drafts,
            including AI-assisted captions, should be reviewed before publication.
          </p>
        </section>
        <section className="legal-section">
          <h2>Availability</h2>
          <p>
            Publishing depends on third-party APIs and may be delayed or
            unavailable because of platform outages, authorization changes,
            review status, or rate limits. No uninterrupted availability is guaranteed.
          </p>
        </section>
        <section className="legal-section">
          <h2>Contact</h2>
          <p>
            Questions about these terms can be sent to{" "}
            <a href="mailto:cfapparel2025@gmail.com">cfapparel2025@gmail.com</a>.
          </p>
        </section>
      </article>
      <PublicLegalFooter />
    </main>
  );
}
