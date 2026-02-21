"use client";

import { setAdminEventContext } from "@/app/admin/actions";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

interface AdminEventSelectorProps {
    events: { _id: string; name: string; active?: boolean }[];
    currentEventId: string | null;
}

export function AdminEventSelector({ events, currentEventId }: AdminEventSelectorProps) {
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleChange = (value: string) => {
        startTransition(async () => {
            await setAdminEventContext(value);
            router.refresh();
        });
    };

    return (
        <Select
            value={currentEventId || undefined}
            onValueChange={handleChange}
            disabled={isPending}
        >
            <SelectTrigger className="w-[180px] h-8 text-sm bg-slate-100 dark:bg-slate-800 border-none">
                <SelectValue placeholder="Seleziona Festa" />
            </SelectTrigger>
            <SelectContent>
                {events.map(event => (
                    <SelectItem key={event._id} value={event._id}>
                        {event.name} {event.active && "(Attiva)"}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
