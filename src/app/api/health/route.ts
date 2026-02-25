import { NextResponse } from 'next/server';
import { normalizeAppSurface } from '@/lib/runtime-surface';

export async function GET() {
    return NextResponse.json({
        status: 'ok',
        surface: normalizeAppSurface(process.env.APP_SURFACE),
        timestamp: new Date().toISOString(),
    });
}
