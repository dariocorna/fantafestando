"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

interface AdminDashboardRealtimeRefreshProps {
    enabled: boolean
    intervalMs: number
}

export function AdminDashboardRealtimeRefresh({ enabled, intervalMs }: AdminDashboardRealtimeRefreshProps) {
    const router = useRouter()

    useEffect(() => {
        if (!enabled || intervalMs < 1000) return

        let cancelled = false
        let timer: number | null = null

        const scheduleNextRefresh = (delayMs: number) => {
            timer = window.setTimeout(() => {
                if (cancelled) return
                if (document.visibilityState === "visible" && document.readyState === "complete") {
                    router.refresh()
                }
                scheduleNextRefresh(intervalMs)
            }, delayMs)
        }

        scheduleNextRefresh(Math.max(intervalMs, 2000))

        return () => {
            cancelled = true
            if (timer !== null) window.clearTimeout(timer)
        }
    }, [enabled, intervalMs, router])

    return null
}
