import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { normalizeAppSurface, resolveSurfaceRedirect } from './lib/runtime-surface';

function shouldSkipPath(pathname: string): boolean {
    return pathname.startsWith('/api/')
        || pathname.startsWith('/_next/')
        || pathname.startsWith('/_vercel/')
        || pathname.startsWith('/favicon')
        || pathname.startsWith('/robots.txt')
        || pathname.startsWith('/sitemap.xml');
}

function isAdminPath(pathname: string): boolean {
    return pathname === '/admin' || pathname.startsWith('/admin/');
}

function isAuthenticatedStaffPath(pathname: string): boolean {
    return pathname === '/pizza-console' || pathname.startsWith('/pizza-console/');
}

export const proxy = auth((request) => {
    const { pathname, search } = request.nextUrl;
    if (shouldSkipPath(pathname)) {
        return NextResponse.next();
    }

    const surface = normalizeAppSurface(process.env.APP_SURFACE);
    const redirectPath = resolveSurfaceRedirect(surface, pathname);
    if (!redirectPath) {
        if (isAdminPath(pathname)) {
            if (!request.auth?.user) {
                const loginUrl = request.nextUrl.clone();
                loginUrl.pathname = '/login';
                loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
                return NextResponse.redirect(loginUrl);
            }

            if (request.auth.user.role !== 'ADMIN') {
                const posUrl = request.nextUrl.clone();
                posUrl.pathname = '/pos';
                posUrl.search = '';
                return NextResponse.redirect(posUrl);
            }
        }

        if (isAuthenticatedStaffPath(pathname) && !request.auth?.user) {
            const loginUrl = request.nextUrl.clone();
            loginUrl.pathname = '/login';
            loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
            return NextResponse.redirect(loginUrl);
        }

        return NextResponse.next();
    }

    const url = request.nextUrl.clone();
    url.pathname = redirectPath;
    url.search = '';
    return NextResponse.redirect(url);
});

export const config = {
    matcher: '/:path*',
};
