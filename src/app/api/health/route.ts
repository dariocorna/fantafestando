import { NextResponse } from 'next/server';
import { normalizeAppSurface } from '@/lib/runtime-surface';
import { getAppVersion, getAppVersionLabel } from '@/lib/app-version';

export async function GET() {
    return NextResponse.json({
        status: 'ok',
        surface: normalizeAppSurface(process.env.APP_SURFACE),
        version: getAppVersion(),
        release: getAppVersionLabel(),
        timestamp: new Date().toISOString(),
    });
}
