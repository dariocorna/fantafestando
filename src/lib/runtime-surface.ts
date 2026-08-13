export type AppSurface = 'all' | 'backoffice' | 'menu';

export function normalizeAppSurface(rawSurface: string | undefined): AppSurface {
    const surface = rawSurface?.trim().toLowerCase();

    if (surface === 'backoffice' || surface === 'menu') {
        return surface;
    }

    return 'all';
}

function isMenuPath(pathname: string): boolean {
    return pathname === '/menu' || pathname.startsWith('/menu/');
}

function isBackofficePath(pathname: string): boolean {
    return pathname === '/admin'
        || pathname.startsWith('/admin/')
        || pathname === '/pos'
        || pathname.startsWith('/pos/');
}

// Static assets always carry an extension; pages and API routes never do.
function isStaticAssetPath(pathname: string): boolean {
    const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
    return lastSegment.includes('.');
}

const MENU_SURFACE_ALLOWED_EXACT_PATHS = [
    '/api/health',
    '/api/pos/init',
    '/api/sumup/webhook',
]

const MENU_SURFACE_ALLOWED_PREFIXES = [
    '/menu',
    '/api/public/',
    '/uploads/',
    '/_next/',
];

/**
 * Allow-list of everything the public menu surface legitimately serves.
 * Anything else (login, backoffice pages, admin/pos/pizza APIs, internal
 * endpoints) must never be reachable from the internet-facing container.
 */
export function isAllowedOnMenuSurface(pathname: string): boolean {
    if (isStaticAssetPath(pathname)) return true;
    if (MENU_SURFACE_ALLOWED_EXACT_PATHS.includes(pathname)) return true;
    return MENU_SURFACE_ALLOWED_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
    );
}

export function isApiPath(pathname: string): boolean {
    return pathname === '/api' || pathname.startsWith('/api/');
}

export function resolveSurfaceRedirect(surface: AppSurface, pathname: string): string | null {
    if (surface === 'all') {
        return null;
    }

    if (surface === 'menu') {
        return isAllowedOnMenuSurface(pathname) ? null : '/menu';
    }

    if (pathname === '/' || isMenuPath(pathname)) {
        return '/admin';
    }

    return null;
}

export { isBackofficePath };
