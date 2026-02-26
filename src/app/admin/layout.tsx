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
                <header className="flex h-16 items-center border-b px-4 bg-white dark:bg-slate-900 shrink-0 justify-between">
                    <div className="flex items-center">
                        <SidebarTrigger />
                        <div className="ml-4 flex items-center gap-2">
                            <div className="font-semibold text-slate-800 dark:text-slate-100">OSGFest Manager</div>
                            <span
                                data-testid="admin-app-version"
                                className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                            >
                                {appVersionLabel}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                            {adminUser.username}
                        </span>
                        <AdminEventSelector events={serializedEvents} currentEventId={currentEventId} />
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
            </main>
        </SidebarProvider>
    );
}
