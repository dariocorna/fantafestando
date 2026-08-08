import { getAdminContextEvent } from "@/lib/events";
import { PortalEasterEggMobile } from "@/components/portal-easter-egg-mobile";
import type { IEvent } from "@/models/Event";
import Printer from "@/models/Printer";

type AdminPrinterOption = {
    id: string;
    name: string;
    ip: string;
    port: number;
};

export default async function AdminEasterEggPage() {
    const contextEvent = await getAdminContextEvent() as IEvent | null;
    if (!contextEvent) {
        return <div>Seleziona una festa prima.</div>;
    }

    const printers = await Printer.find({ eventId: contextEvent._id })
        .select("_id name ip port")
        .sort({ name: 1 })
        .lean() as Array<{
            _id: unknown;
            name?: string;
            ip?: string;
            port?: number;
        }>;

    const printerOptions: AdminPrinterOption[] = printers
        .map((printer) => ({
            id: String(printer._id),
            name: printer.name || "Stampante",
            ip: printer.ip || "",
            port: printer.port || 9100
        }))
        .filter((printer) => printer.ip.trim().length > 0);

    return (
        <PortalEasterEggMobile
            eventId={String(contextEvent._id)}
            eventName={contextEvent.name}
            enabled={Boolean(contextEvent.settings?.portalEasterEggEnabled)}
            printers={printerOptions}
        />
    );
}
