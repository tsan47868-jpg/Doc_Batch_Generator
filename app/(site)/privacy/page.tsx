import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy policy — Doc Batch Generator',
  description: 'What Doc Batch Generator stores, how it is protected, and how to delete it.',
};

const sections: { heading: string; paragraphs: string[] }[] = [
  {
    heading: 'Summary',
    paragraphs: [
      'We store only what the app needs to work: your account details, your chats, your uploaded sample files, and the documents you generate. Nothing is sold or shared with third parties, and your files are visible only to your account.',
    ],
  },
  {
    heading: 'What we store',
    paragraphs: [
      'Account: the email address and password you sign up with, plus an optional display name. Passwords are stored as hashes, never in plain text.',
      'Chats and documents: the instructions you type, the name of your sample file, and the title, description, and text of each generated document. These power your chat history.',
      'Files: the sample you upload and the .docx files generated from it are kept in cloud storage under your account.',
    ],
  },
  {
    heading: 'Who can see your data',
    paragraphs: [
      'Your chats, documents, and files are protected by row-level security and owner-only storage policies enforced at the database level. Other accounts — including other signed-in users — cannot read them.',
    ],
  },
  {
    heading: 'AI processing',
    paragraphs: [
      'To generate documents, the contents of your sample file and your instructions are sent to Google\u2019s Gemini API for processing. They are used to produce your documents and are handled under Google\u2019s API terms. Do not upload documents containing secrets you would not want processed by an external service.',
    ],
  },
  {
    heading: 'Cookies and sessions',
    paragraphs: [
      'The app sets a small number of cookies to keep you signed in and to remember your light or dark theme preference. There are no advertising or tracking cookies.',
    ],
  },
  {
    heading: 'Deletion',
    paragraphs: [
      'Deleting a chat removes its document records; deleting your account removes your chats and documents. If you want your account and all associated data erased, request deletion and it will be processed.',
    ],
  },
  {
    heading: 'Changes',
    paragraphs: [
      'If this policy changes materially, the updated version will be published on this page.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        Privacy policy
      </h1>
      <p className="mt-2 text-sm text-faint">Last updated: October 2026</p>

      <div className="mt-10 space-y-9">
        {sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-xl font-medium text-ink">{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p
                key={i}
                className="mt-3 text-[15px] leading-relaxed text-mute"
              >
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
