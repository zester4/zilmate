'use client'

import { useState, useTransition } from 'react';
import { researchAction } from '../actions';

export default function ResearchPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleResearch = () => {
    if (!query.trim()) return;
    startTransition(async () => {
      const res = await researchAction(query);
      if (res.success) setResult(res.text || '');
    });
  };

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-white flex flex-col gap-8 h-full">
      <header>
        <h2 className="text-2xl font-semibold">Intelligence & Research</h2>
        <p className="text-sm text-gray-500">Access Tavily-powered web intelligence and local docs.</p>
      </header>

      <div className="flex flex-col gap-6 flex-1 min-h-0 pb-8">
        <section className="bg-brand-peach/30 rounded-2xl p-6 border border-brand-rose/10 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-brand-rose uppercase tracking-widest">Initiate Deep Research</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 bg-white border-none rounded-xl px-4 py-4 text-sm focus:ring-2 focus:ring-brand-rose/20 outline-none shadow-sm"
              placeholder="e.g., What are the best practices for AI agent orchestration in 2025?"
            />
            <button
              onClick={handleResearch}
              disabled={isPending || !query.trim()}
              className="bg-brand-rose text-white px-8 rounded-xl text-sm font-semibold hover:bg-brand-rose-dark transition-all shadow-lg shadow-brand-rose/20 disabled:opacity-50"
            >
              Search
            </button>
          </div>
        </section>

        <section className="flex-1 bg-white rounded-2xl p-8 shadow-xl shadow-brand-rose/5 border border-brand-rose/5 overflow-y-auto">
          {isPending ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 opacity-50">
              <div className="w-12 h-12 border-4 border-brand-peach border-t-brand-rose rounded-full animate-spin" />
              <p className="text-sm font-medium text-brand-rose animate-pulse uppercase tracking-widest">Sourcing Intelligence...</p>
            </div>
          ) : result ? (
            <div className="prose prose-brand max-w-none text-sm leading-relaxed whitespace-pre-wrap">{result}</div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-300 italic">Enter a query to begin research...</div>
          )}
        </section>
      </div>
    </main>
  );
}
