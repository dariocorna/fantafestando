import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isApiPath, normalizeAppSurface, resolveSurfaceRedirect } from './lib/runtime-surface';
import { normalizeHostname } from './lib/request-host';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Machine-to-machine callers authenticated by their own secret, not by cookies.
const CSRF_EXEMPT_PREFIXES = ['/api/sumup/webhook', '/api/internal/'];

function shouldSkipPath(pathname: string): boolean {
    return pathname.startsWith('/_next/')
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

/** Internal control-plane endpoints are reachable only from the Docker network. */
function isInternalApiCallerAllowed(requestHostname: string): boolean {
    return (process.env.INTERNAL_API_HOSTNAMES || 'fantafestando-backoffice,localhost,127.0.0.1')
        .split(',')
        .map((value) => normalizeHostname(value))
        .filter(Boolean)
        .includes(requestHostname);
}

/** Same-origin check for cookie-authenticated mutating API calls. */
function isCrossSiteApiRequest(request: Request, requestHostname: string): boolean {
    const source = request.headers.get('origin') || request.headers.get('referer');
    if (!source) return true;
    try {
        return normalizeHostname(new URL(source).host) !== requestHostname;
    } catch {
        return true;
    }
}

export const proxy = auth((request) => {
    const { pathname, search } = request.nextUrl;
    if (shouldSkipPath(pathname)) {
        return NextResponse.next();
    }

    const requestHostname = normalizeHostname(
        request.headers.get('x-forwarded-host') || request.headers.get('host')
    );

    if (pathname.startsWith('/api/internal/') && !isInternalApiCallerAllowed(requestHostname)) {
        return new NextResponse(null, { status: 404 });
    }

    if (isApiPath(pathname)
        && MUTATING_METHODS.has(request.method)
        && !CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
        && isCrossSiteApiRequest(request, requestHostname)) {
        return NextResponse.json({ error: 'Richiesta cross-site non consentita' }, { status: 403 });
    }

    // The POS hostname reaches the same container as the backoffice: the tunnel
    // port alone is not a boundary, so keep the admin surface off it.
    const posOnlyHostname = normalizeHostname(process.env.REMOTE_POS_HOSTNAME);
    if (posOnlyHostname && requestHostname === posOnlyHostname && isAdminPath(pathname)) {
        const posUrl = request.nextUrl.clone();
        posUrl.pathname = '/pos';
        posUrl.search = '';
        return NextResponse.redirect(posUrl);
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

    // A blocked API call must not be redirected into an HTML page.
    if (isApiPath(pathname)) {
        return new NextResponse(null, { status: 404 });
    }

    const url = request.nextUrl.clone();
    url.pathname = redirectPath;
    url.search = '';
    return NextResponse.redirect(url);
});

export const config = {
    matcher: '/:path*',
};
