import Link from 'next/link';

function FileIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M14.5 13.5V5.41a1 1 0 0 0-.3-.7L9.8.29A1 1 0 0 0 9.08 0H1.5v13.5A2.5 2.5 0 0 0 4 16h8a2.5 2.5 0 0 0 2.5-2.5m-1.5 0v-7H8v-5H3v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1M9.5 5V2.12L12.38 5zM5.13 5h-.62v1.25h2.12V5zm-.62 3h7.12v1.25H4.5zm.62 3h-.62v1.25h7.12V11z"
        clipRule="evenodd"
        fillRule="evenodd"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function PlusIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

const features = [
  {
    title: 'Bring your own sample',
    body: 'Upload a .docx, .txt, .md, .csv, .json, or .html file up to 10 MB. The AI studies its structure, tone, and formatting as the template.',
  },
  {
    title: 'Ten documents at once',
    body: 'One message produces a plan and ten distinct documents that follow your sample — different names, weeks, cases, or contexts.',
  },
  {
    title: 'Real Word files',
    body: 'Preview every document inline, then download individual .docx files or grab the whole batch as a single .zip.',
  },
  {
    title: 'Private by default',
    body: 'Your account keeps its own chat history. Files are stored with owner-only access, so nobody else can see your work.',
  },
];

const steps = [
  {
    n: '1',
    title: 'Attach a sample',
    body: 'Pick a document that shows the format you want — a report, letter, invoice, or any Word file.',
  },
  {
    n: '2',
    title: 'Describe the batch',
    body: 'Tell the assistant what the ten documents should vary by, like “ten weekly route reports for different drivers.”',
  },
  {
    n: '3',
    title: 'Download the batch',
    body: 'Review each document in the chat, retry any that fail, then download .docx files or the full .zip.',
  },
];

function AppMock() {
  const docTitles = [
    'Weekly Route Report — J. Smith',
    'Weekly Route Report — M. Lee',
    'Weekly Route Report — A. Patel',
    'Weekly Route Report — K. Osei',
  ];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative mx-auto w-full max-w-xl select-none animate-float"
    >
      <div className="rounded-3xl border border-line bg-panel p-3 shadow-2xl shadow-black/20">
        <div className="flex gap-3">
          <div className="hidden w-36 shrink-0 flex-col gap-2 rounded-2xl border border-line bg-app p-3 sm:flex">
            <div className="flex items-center gap-2 px-1">
              <span className="grid h-6 w-6 place-items-center rounded-lg border border-line bg-bubble">
                <PlusIcon className="h-3 w-3 text-mute" />
              </span>
              <span className="h-1.5 w-14 rounded-full bg-hover2" />
            </div>
            <div className="mt-1 space-y-2 px-1">
              <div className="h-1.5 w-full rounded-full bg-hover" />
              <div className="h-1.5 w-4/5 rounded-full bg-hover" />
              <div className="h-1.5 w-full rounded-full bg-hover" />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-line bg-app p-3">
            <div className="flex flex-col items-end gap-1.5">
              <span className="flex items-center gap-1.5 rounded-full border border-line bg-bubble px-3 py-1 text-[10px] text-mute">
                <FileIcon className="h-3 w-3" /> sample.docx
              </span>
              <span className="max-w-[85%] rounded-2xl bg-accent px-3 py-1.5 text-[10px] leading-snug text-white">
                Generate 10 similar weekly route reports for different drivers
                and weeks.
              </span>
            </div>

            <p className="text-[10px] font-medium text-mute">
              Here are your 10 documents.
            </p>

            <div className="grid gap-2">
              {docTitles.map((title, i) => (
                <div
                  key={title}
                  className="flex items-center gap-2 rounded-xl border border-line bg-bubble px-2.5 py-1.5"
                >
                  <span className="grid h-4 w-4 place-items-center rounded bg-accent-softbg text-[7px] font-bold text-accent-soft">
                    {i + 1}
                  </span>
                  <span className="truncate text-[10px] text-ink">{title}</span>
                  <span className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line bg-app text-mute">
                    <DownloadIcon />
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 opacity-60">
              {docTitles.slice(0, 3).map((t) => (
                <span key={t} className="h-0.5 flex-1 rounded-full bg-hover2" />
              ))}
              <span className="text-[8px] text-faint">4 more…</span>
            </div>

            <div className="mt-auto flex items-center gap-2 rounded-full border border-line bg-bubble px-3 py-2">
              <span className="grid h-4 w-4 place-items-center rounded-full text-mute">
                <PlusIcon className="h-3 w-3" />
              </span>
              <span className="flex-1 text-[10px] text-faint">Ask anything</span>
              <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-white">
                <ArrowRightIcon />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="animate-float-slow absolute -right-3 -top-3 rotate-6 rounded-xl border border-line bg-bubble px-3 py-1.5 text-[10px] font-medium text-mute shadow-lg shadow-black/10">
        10 × .docx
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(74,127,232,0.18),_transparent_40%),radial-gradient(circle_at_bottom_right,_rgba(74,127,232,0.12),_transparent_35%)] animate-drift" />
        <div className="mx-auto grid w-full max-w-5xl gap-12 px-4 pb-16 pt-14 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bubble px-3 py-1 text-xs text-mute">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              AI-powered document generation
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
              One sample in.
              <br />
              Ten Word documents out.
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
              Upload a document that shows the format you need, describe the
              batch in plain words, and get ten ready-to-download .docx files
              that follow your sample.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/app"
                className="inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Start generating <ArrowRightIcon />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-2xl border border-line bg-bubble px-5 py-3 text-[15px] text-ink transition-colors hover:bg-hover"
              >
                See how it works
              </a>
            </div>
            <ul className="mt-8 grid gap-2 text-sm text-mute sm:grid-cols-2">
              {[
                'Basic plan · KES 200 per month',
                'Advanced plan · KES 900 per month',
                'Chats saved to your account',
                'Retry failed documents',
                'Download all as .zip',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckIcon />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <AppMock />
        </div>
      </section>

      <section className="border-t border-line bg-panel">
        <div className="mx-auto w-full max-w-5xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            Why Doc Batch Generator
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-line bg-app p-5"
              >
                <h3 className="text-[15px] font-medium text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mute">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20">
        <div className="mx-auto w-full max-w-5xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            How it works
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {steps.map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-line bg-bubble p-5"
              >
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-softbg text-sm font-semibold text-accent-soft">
                  {s.n}
                </span>
                <h3 className="mt-4 text-[15px] font-medium text-ink">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-mute">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-panel">
        <div className="mx-auto w-full max-w-5xl px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Pricing
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Simple monthly access
            </h2>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-line bg-app p-6 shadow-xl shadow-black/5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-medium text-ink">Basic plan</h3>
              <span className="rounded-full border border-line bg-bubble px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-mute">
                Monthly
              </span>
            </div>

            <div className="mt-5 flex items-end gap-2">
              <span className="text-4xl font-semibold tracking-tight text-ink">
                KES 200
              </span>
              <span className="pb-1 text-sm text-mute">/ month</span>
            </div>

            <ul className="mt-6 space-y-3 text-sm text-mute">
              <li className="flex items-center gap-2">
                <CheckIcon />
                Up to 25 generated documents per month
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                Up to 5 uploads included each month
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                Great for recurring reports and batches
              </li>
            </ul>
            <p className="mt-6 border-t border-line pt-4 text-sm text-mute">
              Pay KES 200 by M-Pesa Send Money to <strong className="text-ink">0117581499</strong> (Akai Loputo). Access starts after payment confirmation and admin activation.
            </p>
          </div>
          <div className="rounded-3xl border border-accent/40 bg-app p-6 shadow-xl shadow-black/5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-medium text-ink">Advanced plan</h3>
              <span className="rounded-full border border-accent/30 bg-accent-softbg px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-accent">
                Community
              </span>
            </div>

            <div className="mt-5 flex items-end gap-2">
              <span className="text-4xl font-semibold tracking-tight text-ink">
                KES 900
              </span>
              <span className="pb-1 text-sm text-mute">/ month</span>
            </div>

            <ul className="mt-6 space-y-3 text-sm text-mute">
              <li className="flex items-center gap-2">
                <CheckIcon />
                Up to 50 detailed, longer Word documents per month
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                Up to 15 sample uploads per month
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                A five-person community to share documents and chat
              </li>
            </ul>
            <p className="mt-6 border-t border-line pt-4 text-sm text-mute">
              Pay KES 900 by M-Pesa Send Money to <strong className="text-ink">0117581499</strong> (Akai Loputo). Access starts after payment confirmation and admin activation.
            </p>
          </div>
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-panel">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5 px-4 py-16 text-center">
          <h2 className="max-w-lg text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Ready to batch out some documents?
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-mute">
            Create and verify your account, pay for a plan using M-Pesa, and wait
            for the administrator to confirm payment and activate access.
          </p>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-2xl bg-accent px-6 py-3 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Open the app <ArrowRightIcon />
          </Link>
        </div>
      </section>
    </>
  );
}
