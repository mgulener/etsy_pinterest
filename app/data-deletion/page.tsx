import type { Metadata } from "next";
import { PublicLegalFooter, PublicLegalHeader } from "@/app/components/PublicLegal";

export const metadata: Metadata = {
  title: "Data Deletion | TheCozyCedar Social Automation",
  description: "Instructions for requesting deletion of connected account data."
};

export default function DataDeletionPage() {
  return (
    <main className="public-legal-shell">
      <PublicLegalHeader />
      <article className="public-legal-document">
        <header>
          <p className="public-kicker">Account control</p>
          <h1>Data Deletion Instructions</h1>
          <p>Last updated September 8, 2026</p>
        </header>

        <section className="legal-section">
          <h2>Disconnect platform access</h2>
          <p>
            First revoke TheCozyCedar Social Automation from the connected Etsy,
            Pinterest, or Instagram/Meta account settings. Revocation prevents the
            application from making new authorized requests but does not by itself
            remove existing operational records.
          </p>
        </section>
        <section className="legal-section">
          <h2>Request deletion</h2>
          <ol>
            <li>
              Email{" "}
              <a href="mailto:cfapparel2025@gmail.com?subject=Data%20Deletion%20Request">
                cfapparel2025@gmail.com
              </a>{" "}
              with the subject “Data Deletion Request.”
            </li>
            <li>Identify the connected platform and account username or ID.</li>
            <li>Send the request from an address associated with the administrator account when possible.</li>
          </ol>
        </section>
        <section className="legal-section">
          <h2>What happens next</h2>
          <p>
            We will verify the request and remove associated OAuth tokens,
            connected account identifiers, unpublished queue entries, and stored
            listing data within 30 days. Minimal publication or security records
            may be retained where required to prevent duplicate actions, resolve
            disputes, or comply with legal obligations.
          </p>
        </section>
        <section className="legal-section">
          <h2>Confirmation</h2>
          <p>
            A confirmation will be sent after the deletion request has been
            completed or if additional information is needed to verify ownership.
          </p>
        </section>
      </article>
      <PublicLegalFooter />
    </main>
  );
}
