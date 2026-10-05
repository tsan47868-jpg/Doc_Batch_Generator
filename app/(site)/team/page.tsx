import type { Metadata } from 'next';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Team — Doc Batch Generator',
  description: 'Meet the people behind Doc Batch Generator.',
};

export default function TeamPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14">
      <div className="grid gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-center">
        <div className="overflow-hidden rounded-[28px] border border-line bg-bubble shadow-xl shadow-black/5">
          <div className="bg-[#f1f1f1] p-2 sm:p-3">
            <Image
              src="/team/portrait.png"
              alt="Portrait of a young man in a light blue shirt"
              width={640}
              height={800}
              className="h-auto w-full rounded-[20px] object-cover"
              priority
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Team
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Meet the people behind the product.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-mute">
            Doc Batch Generator was built to remove the repetitive work hidden in
            everyday document tasks — turning one trusted sample into a reliable
            batch of professional versions without the busywork.
          </p>

          <div className="mt-8 rounded-2xl border border-line bg-panel p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-softbg text-sm font-semibold text-accent-soft">
                GB
              </div>
              <div>
                <h2 className="text-lg font-medium text-ink">Gai Bur</h2>
                <p className="text-sm text-mute">Founder</p>
              </div>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-mute">
              Gai Bur focuses on building tools that help people generate useful,
              repeatable documents faster while keeping the process simple,
              private, and dependable.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
