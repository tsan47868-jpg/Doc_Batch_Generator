import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About — Doc Batch Generator',
  description: 'What Doc Batch Generator is, why it exists, and who it is for.',
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">About</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-mute">
        Doc Batch Generator turns one example document into ten. Instead of
        copying and pasting a template ten times and editing each one by hand,
        you upload the sample once, describe how the ten versions should vary,
        and download finished Word files.
      </p>

      <div className="mt-10 space-y-10">
        <section>
          <h2 className="text-xl font-medium text-ink">Why it exists</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-mute">
            Plenty of work is repetitive but not quite identical — weekly
            reports for different drivers, letters for different recipients,
            invoices for different clients. Writing each variation by hand is
            slow and error-prone. Doc Batch Generator automates the variation
            while keeping the structure and tone of a sample you trust.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-medium text-ink">Who it is for</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-mute">
            Anyone who regularly produces sets of similar documents: operations
            teams writing recurring reports, administrators sending templated
            letters, students generating practice material, and small teams
            that need consistent formatting without a document-automation
            budget.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-medium text-ink">How it is built</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-mute">
            The app runs on Next.js. Document planning and writing use
            Google&apos;s Gemini models, accounts and file storage run on
            InsForge, and generated Word files are produced with the
            open-source docx library. Every chat and file belongs to the
            account that created it — see the{' '}
            <a href="/privacy" className="text-accent hover:underline">
              privacy policy
            </a>{' '}
            for details.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-medium text-ink">A note on limits</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-mute">
            Basic access costs KES 200 per month and includes up to 25 generated
            documents and 5 sample uploads per calendar month. Advanced costs KES 900
            per month and includes 50 documents, 15 uploads, and a five-person
            community for sharing and chat. An administrator
            manually activates access after confirming payment. When a
            generation fails, the app lets you retry individual documents
            instead of starting over.
          </p>
        </section>
      </div>
    </div>
  );
}
