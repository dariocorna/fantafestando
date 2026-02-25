import { NextRequest, NextResponse } from 'next/server';
import { normalizeAppSurface, resolveSurfaceRedirect } from './lib/runtime-surface';

function shouldSkipPath(pathname: string): boolean {
    return pathname.startsWith('/api/')
        || pathname.startsWith('/_next/')
        || pathname.startsWith('/_vercel/')
        || pathname.startsWith('/favicon')
        || pathname.startsWith('/robots.txt')
        || pathname.startsWith('/sitemap.xml');
}

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (shouldSkipPath(pathname)) {
        return NextResponse.next();
    }

    const surface = normalizeAppSurface(process.env.APP_SURFACE);
    const redirectPath = resolveSurfaceRedirect(surface, pathname);
    if (!redirectPath) {
        return NextResponse.next();
    }

    const url = request.nextUrl.clone();
    url.pathname = redirectPath;
    url.search = '';
    return NextResponse.redirect(url);
}

export const config = {
    matcher: '/:path*',
};
