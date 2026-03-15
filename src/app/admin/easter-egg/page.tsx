import { getAdminContextEvent } from "@/lib/events";
import { PortalEasterEggMobile } from "@/components/portal-easter-egg-mobile";
import type { IEvent } from "@/models/Event";

export default async function AdminEasterEggPage() {
    const contextEvent = await getAdminContextEvent() as IEvent | null;
    if (!contextEvent) {
        return <div>Seleziona una festa prima.</div>;
    }

    return (
        <PortalEasterEggMobile
            eventId={String(contextEvent._id)}
            eventName={contextEvent.name}
            enabled={Boolean(contextEvent.settings?.portalEasterEggEnabled)}
        />
    );
}
