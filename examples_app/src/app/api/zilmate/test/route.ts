import { getZilMate } from '@/lib/zilmate';
import { NextResponse } from 'next/server';
export async function GET() {
  try {
    const zilmate = getZilMate('test-session');
    return NextResponse.json({ status: 'initialized', type: typeof zilmate });
  } catch (error) {
    return NextResponse.json({ status: 'error', message: (error as Error).message }, { status: 500 });
  }
}
