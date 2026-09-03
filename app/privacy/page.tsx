export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <main className="page legal-page">
      <div className="page-heading">
        <div>
          <h1>Privacy Policy</h1>
          <p>Last updated: September 3, 2026</p>
        </div>
      </div>

      <section className="legal-section">
        <h2>Overview</h2>
        <p>
          TheCozyCedar Integration is a private internal automation tool used to
          connect TheCozyCedar Etsy shop listings with the shop owner&apos;s
          Pinterest account.
        </p>
      </section>

      <section className="legal-section">
        <h2>Data We Process</h2>
        <p>
          The application reads Etsy listing information such as listing IDs,
          titles, listing URLs, listing states, and listing image URLs. It also
          stores Pinterest publishing queue records and Pinterest Pin IDs after
          pins are created.
        </p>
      </section>

      <section className="legal-section">
        <h2>How Data Is Used</h2>
        <p>
          Data is used only to detect newly created Etsy listings, prevent
          duplicate Pinterest posts, and publish approved listing content to the
          connected Pinterest board.
        </p>
      </section>

      <section className="legal-section">
        <h2>Data Sharing</h2>
        <p>
          The application does not sell personal data. Etsy listing content is
          sent to Pinterest only when creating Pins for the connected Pinterest
          account.
        </p>
      </section>

      <section className="legal-section">
        <h2>Data Storage</h2>
        <p>
          Application data is stored in a private Supabase database and is
          accessed only by server-side application code. API credentials and
          tokens are stored as private server-side configuration or private
          database settings.
        </p>
      </section>

      <section className="legal-section">
        <h2>Contact</h2>
        <p>
          For privacy questions about this internal tool, contact the
          TheCozyCedar shop owner through the Etsy shop page.
        </p>
      </section>
    </main>
  );
}
