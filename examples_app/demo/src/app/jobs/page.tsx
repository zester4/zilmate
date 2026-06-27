'use client'

import { useState, useTransition, useEffect } from 'react';
import { createJobAction, listJobsAction } from '../actions';

export default function JobsPage() {
  const [task, setTask] = useState('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const res = await listJobsAction();
      if (res.success) setJobs(res.jobs || []);
    });
  }, []);

  const handleCreate = () => {
    if (!task.trim()) return;
    startTransition(async () => {
      await createJobAction(task);
      setTask('');
      const res = await listJobsAction();
      if (res.success) setJobs(res.jobs || []);
    });
  };

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-white flex flex-col gap-8 h-full">
      <header>
        <h2 className="text-2xl font-semibold">Automation & Jobs</h2>
        <p className="text-sm text-gray-500">Monitor background swarm tasks and scheduled missions.</p>
      </header>

      <div className="flex flex-col gap-8 pb-8">
        <section className="bg-white rounded-2xl p-6 shadow-xl shadow-brand-rose/5 border border-brand-rose/5">
          <h3 className="text-sm font-bold text-brand-rose uppercase tracking-widest mb-6">Queue Background Mission</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={task}
              onChange={e => setTask(e.target.value)}
              className="flex-1 bg-brand-peach/30 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-rose/20 outline-none"
              placeholder="e.g., Audit the corporation's GitHub repo for dependency updates every week"
            />
            <button
              onClick={handleCreate}
              disabled={isPending || !task.trim()}
              className="bg-brand-rose text-white px-8 rounded-xl text-sm font-semibold hover:bg-brand-rose-dark transition-all disabled:opacity-50"
            >
              Create Job
            </button>
          </div>
        </section>

        <section className="bg-white rounded-2xl p-6 shadow-xl shadow-brand-rose/5 border border-brand-rose/5">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6">Active Jobs</h3>
          <div className="flex flex-col gap-4">
            {jobs.map((job, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-brand-peach/20 rounded-xl border border-brand-rose/5">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-brand-rose-dark">{job.task}</div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{job.status} • {job.schedule || 'One-time'}</div>
                </div>
                <div className="flex gap-2">
                  <button className="text-[10px] font-bold text-brand-rose uppercase tracking-widest hover:underline">View Logs</button>
                  <button className="text-[10px] font-bold text-red-400 uppercase tracking-widest hover:underline">Cancel</button>
                </div>
              </div>
            ))}
            {jobs.length === 0 && (
              <div className="text-gray-300 text-center py-10 italic">No active jobs queued.</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
