'use client';

import Link from 'next/link';
import { Bell, Wallet } from 'lucide-react';

export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between border-b border-slate-100 bg-white/90 px-6 py-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pocketlet-500 text-white shadow-sm">
          <Wallet className="h-5 w-5" />
        </div>
        <span className="text-base font-bold tracking-tight text-slate-800">Pocketlet</span>
      </div>
      <Link
        href="/profile"
        aria-label="Profile"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
      >
        <Bell className="h-4 w-4" />
      </Link>
    </header>
  );
}
