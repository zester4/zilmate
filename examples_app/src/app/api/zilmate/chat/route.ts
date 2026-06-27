import { getZilMate } from '@/lib/zilmate';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    const zilmate = getZilMate('api-session');
    const result = await zilmate.chat({ message });
    return NextResponse.json({ success: true, text: result.text });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
