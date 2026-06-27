import { departments } from '@/lib/swarm-data';

export default function SwarmPage() {
  return (
    <main className="flex-1 p-8 overflow-y-auto bg-white h-full">
      <header className="mb-8">
        <h2 className="text-2xl font-semibold">Swarm Infrastructure</h2>
        <p className="text-sm text-gray-500">Managing 6 specialized departments and 30+ specialists.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-8">
        {departments.map((dept) => (
          <section key={dept.name} className="bg-white rounded-2xl p-6 shadow-xl shadow-brand-rose/5 border border-brand-rose/5 flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-brand-rose-dark">{dept.name}</h3>
                <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-bold">Department</p>
              </div>
              <span className="bg-brand-peach text-brand-rose text-[10px] font-bold px-3 py-1 rounded-full uppercase">Active</span>
            </div>

            <p className="text-sm text-[#4A4543] line-clamp-3 leading-relaxed">
              {dept.mission}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Specialists</div>
              <div className="flex flex-wrap gap-2">
                {dept.specialists.map(s => (
                  <span key={s} className="bg-brand-peach/50 text-[#1E1B19] text-[10px] font-medium px-3 py-1.5 rounded-lg border border-brand-rose/5">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <button className="mt-auto pt-4 border-t border-brand-rose/5 text-xs font-bold text-brand-rose hover:text-brand-rose-dark transition-colors flex items-center gap-2 uppercase tracking-widest">
              View Deployment Details
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </section>
        ))}
      </div>
    </main>
  );
}
