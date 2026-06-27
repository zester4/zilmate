'use client'

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { name: 'Dashboard', href: '/', icon: '📊' },
  { name: 'Swarm', href: '/swarm', icon: '🐝' },
  { name: 'Research', href: '/research', icon: '🔍' },
  { name: 'Memory', href: '/memory', icon: '🧠' },
  { name: 'Jobs', href: '/jobs', icon: '⚙️' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-brand-peach p-6 flex flex-col gap-8 border-r border-brand-rose/10 h-full shrink-0">
      <h1 className="text-xl font-bold text-brand-rose-dark tracking-tight">ZilMate Swarm</h1>
      <nav className="flex flex-col gap-4 text-sm font-medium">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 py-2 px-4 rounded-xl transition-all ${
                isActive
                  ? 'bg-brand-rose text-white shadow-md shadow-brand-rose/20'
                  : 'hover:bg-brand-rose/5 text-[#4A4543]'
              }`}
            >
              <span>{item.icon}</span>
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-4 bg-brand-rose/5 rounded-2xl border border-brand-rose/10">
        <div className="text-[10px] uppercase font-bold text-brand-rose tracking-widest mb-1">Status</div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <div className="text-xs font-semibold text-brand-rose-dark">Swarm Online</div>
        </div>
      </div>
    </aside>
  );
}
