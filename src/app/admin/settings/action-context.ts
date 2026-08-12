import "server-only";

import { ensureAdminSession } from "@/lib/authz";
import { getAdminContextEventId } from "@/lib/events";

export async function requireAdminAuthorization() {
    const sessionCheck = await ensureAdminSession();
    if (!sessionCheck.ok) {
        return { error: sessionCheck.error } as const;
    }
    return null;
}

export async function requireContextEventId() {
    const eventId = await getAdminContextEventId();
    if (!eventId) return null;
    return eventId;
}

export function resolveEventScope(contextEventId: string | null, submittedEventId?: string | null) {
    const normalizedSubmittedEventId = submittedEventId?.trim();
    if (contextEventId && normalizedSubmittedEventId && contextEventId !== normalizedSubmittedEventId) {
        return { error: "La festa selezionata non corrisponde al contesto amministrativo corrente" } as const;
    }

    const eventId = contextEventId || normalizedSubmittedEventId || null;
    if (!eventId) {
        return { error: "Seleziona una festa valida prima di procedere" } as const;
    }

    return { eventId } as const;
}
