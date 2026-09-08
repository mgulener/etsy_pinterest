import type { Metadata } from "next";
import Link from "next/link";
import { PublicLegalFooter, PublicLegalHeader } from "@/app/components/PublicLegal";

export const metadata: Metadata = {
  title: "Privacy Policy | TheCozyCedar Social Automation",
  description: "Privacy policy for TheCozyCedar Social Automation."
};

export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <main className="public-legal-shell">
      <PublicLegalHeader />
      <article className="public-legal-document">
        <header>
          <p className="public-kicker">Legal</p>
          <h1>Privacy Policy</h1>
          <p>Effective September 8, 2026</p>
        </header>

        <LegalSection title="Overview">
          <p>
            TheCozyCedar Social Automation is a private publishing tool operated
            for TheCozyCedar. It connects the shop owner&apos;s Etsy catalog with
            authorized Pinterest and Instagram accounts to prepare, review,
            schedule, and publish product content.
          </p>
        </LegalSection>

        <LegalSection title="Information we process">
          <p>
            We process administrator account information, authorized platform
            account identifiers and OAuth tokens, Etsy listing IDs, titles,
            descriptions, URLs, states, product image URLs, selected media,
            captions, publishing schedules, platform post IDs, and operational
            status or error records.
          </p>
        </LegalSection>

        <LegalSection title="How we use information">
          <p>
            Information is used to authenticate the administrator, import and
            update Etsy listings, prepare social content, allow manual review,
            publish to connected accounts, prevent duplicate posts, retry known
            failures safely, and maintain an operational history.
          </p>
        </LegalSection>

        <LegalSection title="AI-assisted captions">
          <p>
            When AI caption assistance is enabled, a listing&apos;s title,
            description, and destination URL may be sent to OpenAI to generate a
            draft Instagram caption and relevant hashtags. OAuth tokens,
            passwords, and private account credentials are not included in those
            requests. Drafts remain subject to administrator review before use.
          </p>
        </LegalSection>

        <LegalSection title="Service providers and sharing">
          <p>
            We use Etsy, Pinterest, Meta/Instagram, OpenAI, Supabase, and Vercel
            only as needed to operate the workflow. We do not sell personal data
            or use platform data for advertising profiles. Content is shared with
            Pinterest or Instagram only for the connected account&apos;s requested
            publishing activity.
          </p>
        </LegalSection>

        <LegalSection title="Storage, security, and retention">
          <p>
            Application data is stored in a private Supabase database and handled
            by server-side application code hosted on Vercel. Access tokens and
            credentials are restricted to authenticated settings and server-side
            processes. Records are retained while needed to operate the service,
            prevent duplicate publication, resolve failures, and meet applicable
            legal or security obligations.
          </p>
        </LegalSection>

        <LegalSection title="Your choices and data deletion">
          <p>
            Connected access can be revoked through the relevant platform or by
            contacting us. Deletion requests are handled according to our{" "}
            <Link href="/data-deletion">Data Deletion Instructions</Link>.
          </p>
        </LegalSection>

        <LegalSection title="Contact">
          <p>
            Questions or privacy requests can be sent to{" "}
            <a href="mailto:cfapparel2025@gmail.com">cfapparel2025@gmail.com</a>.
          </p>
        </LegalSection>
      </article>
      <PublicLegalFooter />
    </main>
  );
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
