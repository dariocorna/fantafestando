"use client"
import { Home, Settings, UtensilsCrossed, FileText } from "lucide-react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"

const items = [
    {
        title: "Dashboard",
        url: "/admin",
        icon: Home,
    },
    {
        title: "Catalogo",
        url: "/admin/catalog",
        icon: UtensilsCrossed,
    },
    {
        title: "Storico Ordini",
        url: "/admin/orders",
        icon: FileText,
    },
    {
        title: "Impostazioni",
        url: "/admin/settings",
        icon: Settings,
    },
]

export function AppSidebar() {
    const pathname = usePathname();

    return (
        <Sidebar variant="inset" className="border-r border-[#d9e6f8] bg-white/95">
            <SidebarContent className="bg-transparent">
                <SidebarGroup>
                    <SidebarGroupLabel className="text-[var(--brand-blue-700)]">FantaFestando Manager</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton
                                        asChild
                                        className={cn(
                                            "text-slate-700 hover:bg-[#eef5ff] hover:text-[var(--brand-blue-700)]",
                                            pathname === item.url && "bg-[#eef5ff] text-[var(--brand-blue-700)]"
                                        )}
                                    >
                                        <a href={item.url}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </a>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}
