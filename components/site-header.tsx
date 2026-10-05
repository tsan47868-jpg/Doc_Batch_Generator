import Link from 'next/link';
import ThemeToggle from './theme-toggle';

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

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-2.5 py-1.5 text-sm text-mute transition-colors hover:bg-hover hover:text-ink"
    >
      {children}
    </Link>
  );
}

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-app/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 rounded-xl px-1 py-1 transition-opacity hover:opacity-80"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-bubble">
            <FileIcon className="h-4 w-4 text-mute" />
          </span>
          <span className="truncate text-[15px] font-semibold text-ink">
            Doc Batch Generator
          </span>
        </Link>

        <nav className="ml-3 hidden items-center gap-0.5 sm:flex">
          <HeaderLink href="/about">About</HeaderLink>
          <HeaderLink href="/team">Team</HeaderLink>
          <HeaderLink href="/faq">FAQ</HeaderLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/app"
            className="rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Open app
          </Link>
        </div>
      </div>
    </header>
  );
}
