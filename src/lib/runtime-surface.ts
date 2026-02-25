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

export function resolveSurfaceRedirect(surface: AppSurface, pathname: string): string | null {
    if (surface === 'all') {
        return null;
    }

    if (surface === 'menu') {
        if (pathname === '/' || isBackofficePath(pathname)) {
            return '/menu';
        }

        return null;
    }

    if (pathname === '/' || isMenuPath(pathname)) {
        return '/admin';
    }

    return null;
}
