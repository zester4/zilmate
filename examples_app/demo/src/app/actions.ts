'use server'

import { getZilMate } from '@/lib/zilmate';
import { revalidatePath } from 'next/cache';

export async function chatAction(message: string, sessionId: string = 'web-default') {
  try {
    const zilmate = getZilMate(sessionId);
    const result = await zilmate.chat({ message });
    return { success: true, text: result.text };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function researchAction(query: string, sessionId: string = 'web-default') {
  try {
    const zilmate = getZilMate(sessionId);
    const result = await zilmate.research({ query });
    return { success: true, text: result.text };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function rememberAction(text: string, tags: string[] = []) {
  try {
    const zilmate = getZilMate();
    await zilmate.remember({ text, tags });
    revalidatePath('/memory');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function recallAction(query: string) {
  try {
    const zilmate = getZilMate();
    const memories = await zilmate.recall({ query });
    return { success: true, memories };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function createJobAction(task: string, schedule?: string) {
  try {
    const zilmate = getZilMate();
    const job = await zilmate.createJob({ task, schedule });
    revalidatePath('/jobs');
    return { success: true, job };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function listJobsAction() {
  try {
    const zilmate = getZilMate();
    const jobs = await zilmate.listJobs();
    return { success: true, jobs };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
