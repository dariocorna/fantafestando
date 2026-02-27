import type { Metadata } from "next";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AdminEventSelector } from "@/components/admin-event-selector";
import { getAllEvents, getAdminContextEventId } from "@/lib/events";
import { getAppVersionLabel } from "@/lib/app-version";
import { requireAdminPageSession } from "@/lib/authz";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export const metadata: Metadata = {
    title: "Admin Dashboard | OSGFest",
    description: "OSGFest Management Dashboard",
};

export default async function AdminLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
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
            <main className="w-full bg-slate-50 dark:bg-slate-950 min-h-screen">
                <header className="flex min-h-16 flex-wrap items-center gap-3 border-b bg-white px-4 py-2 dark:bg-slate-900 shrink-0 justify-between">
                    <div className="flex min-w-0 items-center">
                        <SidebarTrigger />
                        <div className="ml-4 flex min-w-0 items-center gap-2">
                            <div className="truncate font-semibold text-slate-800 dark:text-slate-100">OSGFest Manager</div>
                        </div>
                    </div>
                    <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3">
                        <span className="hidden text-sm text-slate-500 dark:text-slate-400 sm:inline">
                            {adminUser.username}
                        </span>
                        <div className="w-full min-w-0 sm:w-auto">
                            <AdminEventSelector events={serializedEvents} currentEventId={currentEventId} />
                        </div>
                        <form action={logoutAdmin}>
                            <Button type="submit" variant="outline" size="sm" className="gap-1">
                                <LogOut className="h-4 w-4" />
                                Esci
                            </Button>
                        </form>
                    </div>
                </header>
                <div className="p-6">
                    {children}
                </div>
                <footer className="border-t bg-white px-4 py-3 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>Copyright 2026 OSGFest</span>
                        <span data-testid="admin-app-version">{appVersionLabel}</span>
                    </div>
                </footer>
            </main>
        </SidebarProvider>
    );
}
