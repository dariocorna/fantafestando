import { describe, expect, test } from 'vitest';
import { normalizeAppSurface, resolveSurfaceRedirect } from '@/lib/runtime-surface';

describe('normalizeAppSurface', () => {
    test('returns all for empty/unknown values', () => {
        expect(normalizeAppSurface(undefined)).toBe('all');
        expect(normalizeAppSurface('')).toBe('all');
        expect(normalizeAppSurface('unknown')).toBe('all');
    });

    test('normalizes valid surfaces', () => {
        expect(normalizeAppSurface('menu')).toBe('menu');
        expect(normalizeAppSurface('backoffice')).toBe('backoffice');
        expect(normalizeAppSurface(' MENU ')).toBe('menu');
    });
});

describe('resolveSurfaceRedirect', () => {
    test('does not redirect in all surface', () => {
        expect(resolveSurfaceRedirect('all', '/')).toBeNull();
        expect(resolveSurfaceRedirect('all', '/menu')).toBeNull();
        expect(resolveSurfaceRedirect('all', '/admin')).toBeNull();
    });

    test('menu surface redirects root and backoffice routes to /menu', () => {
        expect(resolveSurfaceRedirect('menu', '/')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/admin')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/admin/settings')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/pos')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/pos/orders')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/menu')).toBeNull();
        expect(resolveSurfaceRedirect('menu', '/menu/checkout')).toBeNull();
    });

    test('menu surface blocks everything outside the public allow-list', () => {
        expect(resolveSurfaceRedirect('menu', '/login')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/pizza-console')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/pizza-monitor')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/api/admin/backups/download')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/api/internal/remote-access')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/api/pizza-console/tickets')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/api/auth/callback/credentials')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/api/sumup/webhook/extra')).toBe('/menu');
        expect(resolveSurfaceRedirect('menu', '/menuevil')).toBe('/menu');
    });

    test('menu surface keeps serving what the public portal needs', () => {
        expect(resolveSurfaceRedirect('menu', '/api/public/pizza-monitor')).toBeNull();
        expect(resolveSurfaceRedirect('menu', '/api/health')).toBeNull();
        expect(resolveSurfaceRedirect('menu', '/api/pos/init')).toBeNull();
        expect(resolveSurfaceRedirect('menu', '/api/sumup/webhook')).toBeNull();
        expect(resolveSurfaceRedirect('menu', '/uploads/menu-headers/logo.png')).toBeNull();
        expect(resolveSurfaceRedirect('menu', '/sw-menu.js')).toBeNull();
        expect(resolveSurfaceRedirect('menu', '/manifest-menu.webmanifest')).toBeNull();
        expect(resolveSurfaceRedirect('menu', '/icons/icon-192.png')).toBeNull();
    });

    test('backoffice surface redirects root and menu routes to /admin', () => {
        expect(resolveSurfaceRedirect('backoffice', '/')).toBe('/admin');
        expect(resolveSurfaceRedirect('backoffice', '/menu')).toBe('/admin');
        expect(resolveSurfaceRedirect('backoffice', '/menu/checkout')).toBe('/admin');
        expect(resolveSurfaceRedirect('backoffice', '/admin')).toBeNull();
        expect(resolveSurfaceRedirect('backoffice', '/admin/settings')).toBeNull();
        expect(resolveSurfaceRedirect('backoffice', '/pos')).toBeNull();
    });
});
