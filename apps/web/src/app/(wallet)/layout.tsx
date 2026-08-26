import AppHeader from '@/components/AppHeader';
import BottomNav from '@/components/BottomNav';

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50 border">
      <AppHeader />
      <main className="flex-1 px-6 py-4">{children}</main>
      <BottomNav />
    </div>
  );
}
