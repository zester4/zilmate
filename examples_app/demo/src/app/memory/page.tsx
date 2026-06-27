'use client'

import { useState, useTransition } from 'react';
import { rememberAction, recallAction } from '../actions';

export default function MemoryPage() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [memories, setMemories] = useState<any[]>([]);
  const [isPending, startTransition] = useTransition();

  const handleRemember = () => {
    if (!text.trim()) return;
    startTransition(async () => {
      await rememberAction(text);
      setText('');
      alert('Memory stored in ZilMate Swarm');
    });
  };

  const handleRecall = () => {
    startTransition(async () => {
      const result = await recallAction(query);
      if (result.success) setMemories(result.memories || []);
    });
  };

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-white flex flex-col gap-8 h-full">
      <header>
        <h2 className="text-2xl font-semibold text-[#1E1B19]">Corporate Memory</h2>
        <p className="text-sm text-gray-500">Search and store durable project facts and preferences.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 min-h-0 pb-8">
        <section className="bg-white rounded-2xl p-6 shadow-xl shadow-brand-rose/5 border border-brand-rose/5 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-brand-rose uppercase tracking-widest">Remember Fact</h3>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            className="flex-1 min-h-[200px] bg-brand-peach/30 border-none rounded-xl p-4 text-sm focus:ring-2 focus:ring-brand-rose/20 outline-none resize-none"
            placeholder="e.g., User prefers Tailwind CSS and App Router for all Next.js projects."
          />
          <button
            onClick={handleRemember}
            disabled={isPending || !text.trim()}
            className="bg-brand-rose text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-brand-rose-dark transition-all disabled:opacity-50"
          >
            Store Memory
          </button>
        </section>

        <section className="bg-white rounded-2xl p-6 shadow-xl shadow-brand-rose/5 border border-brand-rose/5 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-brand-rose uppercase tracking-widest">Recall Intelligence</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 bg-brand-peach/30 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-rose/20 outline-none"
              placeholder="Search memories..."
            />
            <button
              onClick={handleRecall}
              className="bg-brand-peach text-brand-rose px-6 rounded-xl text-sm font-semibold hover:bg-brand-rose/10 transition-colors"
            >
              Search
            </button>
          </div>
          <div className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-[200px]">
            {memories.map((m, i) => (
              <div key={i} className="p-4 bg-brand-peach/20 rounded-xl border border-brand-rose/5 text-sm leading-relaxed shadow-sm">
                {m.text}
              </div>
            ))}
            {memories.length === 0 && !isPending && (
              <div className="flex items-center justify-center h-full text-gray-300 italic">No memories found.</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
