import type { Metadata } from "next";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AdminEventSelector } from "@/components/admin-event-selector";
import { getAllEvents, getAdminContextEventId } from "@/lib/events";

export const metadata: Metadata = {
    title: "Admin Dashboard | OSGFest",
    description: "OSGFest Management Dashboard",
};

export default async function AdminLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const events = await getAllEvents();
    const selectableEvents = events.filter(event => !event.archived);
    // Convertiamo l'id a stringa per inviarlo al Client Component
    const serializedEvents = selectableEvents.map(e => ({
        _id: String(e._id),
        name: e.name,
        active: e.active
    }));
    const currentEventId = await getAdminContextEventId();

    return (
        <SidebarProvider>
            <AppSidebar />
            <main className="w-full bg-slate-50 dark:bg-slate-950 min-h-screen">
                <header className="flex h-16 items-center border-b px-4 bg-white dark:bg-slate-900 shrink-0 justify-between">
                    <div className="flex items-center">
                        <SidebarTrigger />
                        <div className="ml-4 font-semibold text-slate-800 dark:text-slate-100">OSGFest Manager</div>
                    </div>
                    <div className="flex items-center">
                        <AdminEventSelector events={serializedEvents} currentEventId={currentEventId} />
                    </div>
                </header>
                <div className="p-6">
                    {children}
                </div>
            </main>
        </SidebarProvider>
    );
}
