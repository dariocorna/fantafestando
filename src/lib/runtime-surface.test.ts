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

    test('backoffice surface redirects root and menu routes to /admin', () => {
        expect(resolveSurfaceRedirect('backoffice', '/')).toBe('/admin');
        expect(resolveSurfaceRedirect('backoffice', '/menu')).toBe('/admin');
        expect(resolveSurfaceRedirect('backoffice', '/menu/checkout')).toBe('/admin');
        expect(resolveSurfaceRedirect('backoffice', '/admin')).toBeNull();
        expect(resolveSurfaceRedirect('backoffice', '/admin/settings')).toBeNull();
        expect(resolveSurfaceRedirect('backoffice', '/pos')).toBeNull();
    });
});
