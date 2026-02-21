"use client"
import { Calendar, Home, Settings, UtensilsCrossed, FileText } from "lucide-react"

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
        title: "Eventi",
        url: "/admin/events",
        icon: Calendar,
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
    return (
        <Sidebar variant="inset">
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>OSGFest Manager</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild>
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
