'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import BrandMark from '../ui/BrandMark.js';
import { BRAND } from '../../lib/constants/brand.js';
import { DIRECTORY_PATH, directoryHref } from '../../lib/ui/public-directory.js';

// The public landing page (signed out, "/"): the campus photo under a maroon wash, the headline, a search box and the way into the
// Service Directory. Searching or Browse all services opens the existing directory (DIRECTORY_PATH); nothing is fetched here.
export default function LandingHero() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  function onSubmit(event) {
    event.preventDefault();
    router.push(directoryHref(query));
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#570D12] text-white">
      <header className="bg-[#570D12]">
        <div className="mx-auto flex max-w-[90rem] items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-6 lg:px-16">
          <Link href="/" className="flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFDF00]">
            <BrandMark size={40} />
            <span>
              <span className="block text-base font-bold leading-tight">{BRAND.campus}</span>
              <span className="block text-xs font-semibold tracking-wider text-white/75">{BRAND.system}</span>
            </span>
          </Link>
          <Link href="/login" className="rounded-lg border border-[#FFDF00] px-4 py-2 text-sm font-semibold text-[#FFDF00] transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFDF00] sm:px-5 sm:py-2.5">
            Staff Login
          </Link>
        </div>
      </header>

      <main className="relative isolate flex flex-1 items-center overflow-hidden">
        {/* The pylon is at 65% across the photo. From the tablet size up the photo is 129% as wide as the screen (the extra is cropped on the right), which puts the pylon about 84% across, clear of the text. */}
        <div className="absolute inset-0 -z-10" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Background.png" alt="" data-testid="hero-photo" className="h-full w-full object-cover object-[70%_50%] md:w-[129%] md:max-w-none md:object-[65%_25%]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#570D12]/85 via-[#570D12]/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#570D12]/20 via-transparent to-[#570D12]/30" />
        </div>

        <div className="mx-auto w-full max-w-[90rem] px-4 py-12 sm:px-8 sm:py-16 lg:px-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80 sm:text-sm">Citizen&rsquo;s Charter &middot; {BRAND.campus}</p>
          <h1 className="mt-5 max-w-[12.5em] font-serif text-4xl font-normal leading-[1.08] text-[#F8F5F0] sm:text-6xl lg:text-[4.5rem]">
            Find a service. Know <em className="text-[#FFDF00]">what to bring</em> and how long it takes.
          </h1>
          <p className="mt-6 text-base text-white/90 sm:text-lg">Search the Citizen&rsquo;s Charter before you visit an office.</p>

          <form onSubmit={onSubmit} role="search" className="mt-8 flex w-full max-w-xl items-center gap-2 rounded-2xl bg-[#F8F5F0] p-2 shadow-lg focus-within:ring-2 focus-within:ring-[#FFDF00]">
            <label className="sr-only" htmlFor="landing-search">Search by service or office name</label>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-2 h-5 w-5 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="landing-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by service or office name"
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-base text-slate-900 placeholder:text-slate-500 focus:outline-none"
            />
            <button type="submit" className="shrink-0 rounded-xl bg-[#570D12] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#800000] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-2">
              Search
            </button>
          </form>

          <Link href={DIRECTORY_PATH} className="mt-5 inline-flex items-center gap-3 rounded-xl bg-[#FFDF00] px-6 py-3.5 text-base font-bold text-[#2B0A0D] transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#570D12]">
            Browse all services <span aria-hidden="true">&rarr;</span>
          </Link>
          <p className="mt-5 max-w-md text-sm text-white/85">Every service shows its requirements, steps, and processing time.</p>
        </div>
      </main>
    </div>
  );
}
