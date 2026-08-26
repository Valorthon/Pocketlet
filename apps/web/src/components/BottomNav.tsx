'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowDownLeft, Clock, Fingerprint, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/home', label: 'Home', icon: Wallet },
  { href: '/receive', label: 'Receive', icon: ArrowDownLeft },
  { href: '/transactions', label: 'History', icon: Clock },
  { href: '/profile', label: 'Profile', icon: Fingerprint },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="flex h-20 shrink-0 items-center justify-around border-t border-slate-100 bg-white px-4">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex flex-col items-center gap-1 transition-colors',
              active ? 'text-pocketlet-600' : 'text-slate-400 hover:text-slate-600'
            )}
          >
            <Icon className="h-6 w-6" />
            <span className="text-[10px] font-bold">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
