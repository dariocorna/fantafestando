import dbConnect from "@/lib/mongoose";
import { ensureAdminSession } from "@/lib/authz";
import Event, { IEvent } from "@/models/Event";
import Category from "@/models/Category";
import Product from "@/models/Product";
import Printer from "@/models/Printer";
import PosDevice from "@/models/PosDevice";
import Peripheral from "@/models/Peripheral";
import Order from "@/models/Order";
import Ingredient from "@/models/Ingredient";
import CashSession from "@/models/CashSession";
import PrintJob from "@/models/PrintJob";
import OrderCounter from "@/models/OrderCounter";
import { DeleteForm } from "@/components/delete-form";
import { ArchiveForm } from "@/components/archive-form";
import { revalidatePath } from "next/cache";
import { CreateEventDialog } from "@/components/create-event-dialog";
import { CloneEventDialog } from "@/components/clone-event-dialog";
import { ImportEventDialog } from "@/components/import-event-dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export default async function EventsPage() {
    await dbConnect();
    const events = await Event.find({}).sort({ createdAt: -1 }).lean();

    async function deleteEvent(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const eventId = formData.get("eventId") as string;
        if (!eventId) return;

        await dbConnect();
        // Full cascade delete for all festa-bound data
        await PrintJob.deleteMany({ eventId });
        await CashSession.deleteMany({ eventId });
        await Order.deleteMany({ eventId });
        await OrderCounter.deleteMany({ eventId });
        await PosDevice.deleteMany({ eventId });
        await Peripheral.deleteMany({ eventId });
        await Printer.deleteMany({ eventId });
        await Product.deleteMany({ eventId });
        await Ingredient.deleteMany({ eventId });
        await Category.deleteMany({ eventId });
        await Event.findByIdAndDelete(eventId);

        revalidatePath("/admin/settings/events");
    }

    async function archiveEvent(formData: FormData) {
        "use server"
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return;

        const eventId = formData.get("eventId") as string;
        if (!eventId) return;

        await dbConnect();
        await Event.findByIdAndUpdate(eventId, {
            archived: true,
            active: false
        });
        revalidatePath("/admin/settings/events");
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold tracking-tight">Feste (Eventi)</h1>
                <div className="flex items-center gap-2">
                    <ImportEventDialog importUrl="/api/admin/events/import" />
                    <CreateEventDialog />
                </div>
            </div>

            {events.length === 0 ? (
                <div className="border border-dashed rounded-lg p-10 text-center">
                    <p className="text-muted-foreground">Nessuna festa configurata. Creane una per iniziare.</p>
                </div>
            ) : (
                <div className="grid gap-4 mt-6">
                    {events.map((evt: IEvent) => (
                        <div key={String(evt._id)} className="p-4 border rounded-md shadow-sm bg-white dark:bg-slate-900 flex justify-between items-center">
                            <div>
                                <h3 className="font-semibold text-lg">{evt.name} {evt.archived && <span className="text-xs ml-2 bg-amber-100 text-amber-800 px-2 py-1 rounded">Archiviata</span>}</h3>
                                <div className="flex gap-4 mt-1">
                                    {!evt.archived && (
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${evt.active ? 'bg-green-100 text-green-700 font-bold' : 'bg-gray-100 text-gray-700'}`}>
                                            {evt.active ? "Attiva (Globale)" : "Inattiva"}
                                        </span>
                                    )}
                                    <span className="text-xs text-slate-500">
                                        Campi: {evt.settings?.askName ? 'Nome' : ''} {evt.settings?.askTable ? 'Tavolo' : ''} {(!evt.settings?.askName && !evt.settings?.askTable) ? 'Nessuno' : ''}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button asChild variant="outline" size="sm">
                                    <a href={`/api/admin/events/${String(evt._id)}/export`} download>
                                        <Download className="h-4 w-4" />
                                        Esporta
                                    </a>
                                </Button>

                                <CloneEventDialog sourceEventId={String(evt._id)} sourceEventName={evt.name} />

                                {!evt.archived && (
                                    <ArchiveForm
                                        id={String(evt._id)}
                                        idName="eventId"
                                        message="Questa festa non sarà più modificabile e scompariranno le impostazioni. Confermi l'archiviazione?"
                                        action={archiveEvent}
                                        buttonSize="icon"
                                        iconSize={18}
                                    />
                                )}

                                <DeleteForm
                                    id={String(evt._id)}
                                    idName="eventId"
                                    message="Eliminare questa festa? Questo rimuoverà permanentemente TUTTI i prodotti e le categorie associate."
                                    action={deleteEvent}
                                    buttonSize="icon"
                                    iconSize={18}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
