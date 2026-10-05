import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FAQ — Doc Batch Generator',
  description: 'Frequently asked questions about generating documents with Doc Batch Generator.',
};

const faqs: { q: string; a: string[] }[] = [
  {
    q: 'How many documents does one generation produce?',
    a: [
      'A run produces up to ten documents. Basic allows up to 25 generated documents and 5 sample uploads each calendar month; Advanced allows up to 50 generated documents and 15 sample uploads. The last run may contain fewer documents if fewer than ten remain.',
    ],
  },
  {
    q: 'What kind of file can I upload as a sample?',
    a: [
      'Word documents (.docx), plain text and Markdown (.txt, .md), CSV, JSON, and HTML files are supported, up to 10 MB. The AI reads the sample to learn the structure and tone you want.',
    ],
  },
  {
    q: 'Do I need an account?',
    a: [
      'Yes. Sign up with an email and password and confirm your address with a 6-digit code. Your account is what keeps your chat history and files private to you.',
    ],
  },
  {
    q: 'Who can see my files and chats?',
    a: [
      'Chats, documents, and uploaded files are private to you unless you explicitly share a generated document with your Advanced community. Community members can see only documents shared to that community and messages posted there. For account support and usage tracking, the administrator can review your generation instructions, document titles, and app-observed Gemini usage; document contents are not shown in the admin dashboard.',
    ],
  },
  {
    q: 'What if a document fails to generate?',
    a: [
      'Each document is retried on its own, and you can press “Retry failed” to regenerate just the ones that failed instead of repeating the whole batch.',
    ],
  },
  {
    q: 'What formats can I download?',
    a: [
      'Every document is available as a .docx Word file, and you can download the whole batch as a single .zip. You can also re-download the sample file from a past chat.',
    ],
  },
  {
    q: 'Is there a usage limit?',
    a: [
      'Basic costs KES 200/month (25 generated documents and 5 sample uploads). Advanced costs KES 900/month (50 generated documents, 15 uploads, and a five-person community for sharing and chat). An administrator manually activates access after confirming payment; payments are not processed in the app.',
    ],
  },
  {
    q: 'How do I get Basic plan access?',
    a: [
      'Create and verify your account, then contact the administrator to confirm payment and activate your monthly access.',
    ],
  },
  {
    q: 'What does Advanced include?',
    a: [
      'Advanced produces longer, more detailed and better-structured Word documents, with up to 50 documents and 15 sample uploads per month. It also includes a private five-person community (owner included) for sharing generated documents and chatting.',
    ],
  },
  {
    q: 'Can I come back to a previous batch?',
    a: [
      'Yes. Every chat is saved to your account with its instructions, sample file, and generated documents. Open it again from the history in the sidebar to preview or re-download the files.',
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        Frequently asked questions
      </h1>

      <div className="mt-8 divide-y divide-divider rounded-2xl border border-line bg-bubble">
        {faqs.map((f) => (
          <details key={f.q} className="group px-5 py-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium text-ink [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-line bg-app text-mute transition-transform group-open:rotate-45">
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </summary>
            <div className="pb-4">
              {f.a.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-mute">
                  {p}
                </p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
