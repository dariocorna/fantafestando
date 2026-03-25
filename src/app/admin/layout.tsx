import type { Metadata, Viewport } from "next";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AdminEventSelector } from "@/components/admin-event-selector";
import { getAllEvents, getAdminContextEventId } from "@/lib/events";
import { getAppVersionLabel } from "@/lib/app-version";
import { requireAdminPageSession } from "@/lib/authz";
import { ensureRuntimeBackupSchedulerStarted } from "@/lib/runtime-backup-scheduler";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { BrandLogoLockup } from "@/components/brand/brand-logo-lockup";

export const metadata: Metadata = {
    title: "Admin Dashboard | FantaFestando",
    description: "FantaFestando Management Dashboard",
};

export const viewport: Viewport = {
    themeColor: "#0f172a",
};

export default async function AdminLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    ensureRuntimeBackupSchedulerStarted();

    const adminUser = await requireAdminPageSession();
    const events = await getAllEvents();
    const selectableEvents = events.filter(event => !event.archived);
    // Convertiamo l'id a stringa per inviarlo al Client Component
    const serializedEvents = selectableEvents.map(e => ({
        _id: String(e._id),
        name: e.name,
        active: e.active
    }));
    const currentEventId = await getAdminContextEventId();
    const appVersionLabel = getAppVersionLabel();

    async function logoutAdmin() {
        "use server";
        await signOut({ redirectTo: "/login" });
    }

    return (
        <SidebarProvider>
            <AppSidebar />
            <main className="brand-surface-admin w-full min-h-screen">
                <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#d9e6f8] bg-white/95 px-4 py-2 backdrop-blur">
                    <div className="flex min-w-0 items-center">
                        <SidebarTrigger />
                        <BrandLogoLockup
                            title="FantaFestando Manager"
                            subtitle={selectableEvents.find(e => String(e._id) === currentEventId)?.name || "Festa"}
                            compact
                            variant="admin"
                            className="ml-3"
                            data-testid="admin-brand-lockup"
                        />
                    </div>
                    <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3">
                        <span className="hidden text-sm text-slate-500 sm:inline">
                            {adminUser.username}
                        </span>
                        <div className="w-full min-w-0 sm:w-auto">
                            <AdminEventSelector events={serializedEvents} currentEventId={currentEventId} />
                        </div>
                        <form action={logoutAdmin}>
                            <Button type="submit" variant="outline" size="sm" className="gap-1 border-[#d9e6f8] bg-white text-[var(--brand-blue-700)] hover:bg-[#eef5ff]">
                                <LogOut className="h-4 w-4" />
                                Esci
                            </Button>
                        </form>
                    </div>
                </header>
                <div className="p-6">
                    {children}
                </div>
                <footer className="border-t border-[#d9e6f8] bg-white/90 px-4 py-3 text-xs text-slate-600">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>Copyright 2026 FantaFestando</span>
                        <span data-testid="admin-app-version">{appVersionLabel}</span>
                    </div>
                </footer>
            </main>
        </SidebarProvider>
    );
}
