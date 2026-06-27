'use client'

import { useState, useTransition } from 'react';
import { chatAction } from './actions';

const departments = [
  { name: 'Strategy', status: 95, detail: 'Optimal' },
  { name: 'Engineering', status: 88, detail: 'Optimal' },
  { name: 'Growth', status: 72, detail: 'Busy' },
  { name: 'Operations', status: 100, detail: 'Idle' },
  { name: 'Data', status: 84, detail: 'Optimal' },
];

export default function Dashboard() {
  const [message, setMessage] = useState('');
  const [chatLog, setChatLog] = useState<{ role: 'user' | 'ai', text: string }[]>([]);
  const [isPending, startTransition] = useTransition();

  const handleSend = async () => {
    if (!message.trim()) return;

    const userMsg = message;
    setMessage('');
    setChatLog(prev => [...prev, { role: 'user', text: userMsg }]);

    startTransition(async () => {
      const result = await chatAction(userMsg);
      if (result.success) {
        setChatLog(prev => [...prev, { role: 'ai', text: result.text! }]);
      } else {
        setChatLog(prev => [...prev, { role: 'ai', text: 'Error: ' + result.error }]);
      }
    });
  };

  return (
    <main className="flex-1 flex flex-col p-8 gap-8 overflow-hidden h-full bg-white">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold">Command Center</h2>
          <p className="text-sm text-gray-500">Welcome back, Coordinator. Swarm is standing by.</p>
        </div>
        <div className="flex gap-4">
          <button className="bg-brand-peach text-brand-rose px-6 py-2 rounded-full text-sm font-semibold hover:bg-brand-rose/10 transition-colors">New Mission</button>
          <button className="bg-brand-rose text-white px-6 py-2 rounded-full text-sm font-semibold shadow-lg shadow-brand-rose/20 hover:bg-brand-rose-dark transition-all">Analyze Swarm ROI</button>
        </div>
      </header>

      <div className="flex-1 flex gap-8 min-h-0">
        <section className="flex-[2] bg-white rounded-2xl shadow-xl shadow-brand-rose/5 border border-brand-rose/5 flex flex-col min-w-0">
          <div className="p-4 border-b border-brand-rose/5 font-semibold text-brand-rose flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-rose animate-pulse" />
            Talk to ZilMate
          </div>
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
            {chatLog.length === 0 && (
              <div className="text-gray-400 text-center mt-20 italic">
                <div className="text-4xl mb-4">👋</div>
                Start a mission or ask ZilMate to coordinate the swarm...
              </div>
            )}
            {chatLog.map((log, i) => (
              <div key={i} className={`flex ${log.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${
                  log.role === 'user'
                    ? 'bg-brand-rose text-white rounded-tr-none'
                    : 'bg-brand-peach text-[#1E1B19] rounded-tl-none'
                }`}>
                  {log.text}
                </div>
              </div>
            ))}
            {isPending && (
              <div className="flex justify-start">
                <div className="bg-brand-peach text-[#1E1B19] p-4 rounded-2xl rounded-tl-none text-sm animate-pulse">
                  ZilMate is coordinating with specialists...
                </div>
              </div>
            )}
          </div>
          <div className="p-4 border-t border-brand-rose/5 flex gap-2 bg-white rounded-b-2xl">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Assign a task to the swarm..."
              className="flex-1 bg-brand-peach/30 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-rose/20 outline-none transition-all placeholder:text-brand-rose/40"
              disabled={isPending}
            />
            <button
              onClick={handleSend}
              disabled={isPending || !message.trim()}
              className="bg-brand-rose text-white w-12 h-12 rounded-xl flex items-center justify-center hover:bg-brand-rose-dark transition-colors disabled:opacity-50 shadow-md shadow-brand-rose/10"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </section>

        <aside className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 min-w-[300px]">
          <section className="bg-white rounded-2xl p-6 shadow-xl shadow-brand-rose/5 border border-brand-rose/5">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">Swarm Status</h3>
            <div className="flex flex-col gap-6">
              {departments.map(dept => (
                <div key={dept.name} className="flex items-center gap-4 group cursor-help">
                  <div className="relative w-12 h-12 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-brand-peach" />
                      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={2 * Math.PI * 20} strokeDashoffset={2 * Math.PI * 20 * (1 - dept.status/100)} className="text-brand-rose" />
                    </svg>
                    <span className="absolute text-[10px] font-bold text-brand-rose-dark">{dept.status}%</span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold group-hover:text-brand-rose transition-colors">{dept.name}</div>
                    <div className={`text-[10px] font-bold uppercase ${dept.detail === 'Optimal' ? 'text-green-500' : 'text-orange-400'}`}>
                      {dept.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-2xl p-6 shadow-xl shadow-brand-rose/5 border border-brand-rose/5">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Recent Swarm Reports</h3>
            <div className="flex flex-col gap-3">
              {[
                { title: 'Q2 Strategic Audit.md', dept: 'Engineering', time: '2h ago' },
                { title: 'Growth Vectors V3.md', dept: 'Growth', time: '5h ago' },
                { title: 'Fiscal Forecast.pdf', dept: 'Operations', time: '1d ago' },
              ].map((report, i) => (
                <div key={i} className="p-3 bg-brand-peach/30 rounded-xl flex flex-col gap-1 border border-brand-rose/5 cursor-pointer hover:border-brand-rose/30 transition-all hover:bg-brand-peach/50">
                  <div className="text-xs font-semibold text-brand-rose-dark">{report.title}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">{report.dept} • {report.time}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
