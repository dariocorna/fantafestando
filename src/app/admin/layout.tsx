import type { Metadata } from "next";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export const metadata: Metadata = {
    title: "Admin Dashboard | OSGFest",
    description: "OSGFest Management Dashboard",
};

export default function AdminLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <SidebarProvider>
            <AppSidebar />
            <main className="w-full bg-slate-50 dark:bg-slate-950 min-h-screen">
                <header className="flex h-16 items-center border-b px-4 bg-white dark:bg-slate-900 shrink-0">
                    <SidebarTrigger />
                    <div className="ml-4 font-semibold text-slate-800 dark:text-slate-100">OSGFest Manager</div>
                </header>
                <div className="p-6">
                    {children}
                </div>
            </main>
        </SidebarProvider>
    );
}
