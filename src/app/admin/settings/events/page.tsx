import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import Category from "@/models/Category";
import Product from "@/models/Product";
import { Button } from "@/components/ui/button";
import { DeleteForm } from "@/components/delete-form";
import { ArchiveForm } from "@/components/archive-form";
import { revalidatePath } from "next/cache";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function EventsPage() {
    await dbConnect();
    const events = await Event.find({}).sort({ createdAt: -1 }).lean();

    async function createEvent(formData: FormData) {
        "use server"
        const name = formData.get("name") as string;
        if (!name) return;

        await dbConnect();
        await Event.create({
            name,
            active: false,
            settings: { askName: false, askTable: false }
        });

        revalidatePath("/admin/settings/events");
    }

    async function updateEventSettings(formData: FormData) {
        "use server"
        const eventId = formData.get("eventId") as string;
        const askName = formData.get("askName") === "on";
        const askTable = formData.get("askTable") === "on";
        const defaultCashierPrinterIp = formData.get("defaultCashierPrinterIp") as string;
        const active = formData.get("active") === "on";

        if (!eventId) return;

        await dbConnect();

        if (active) {
            // Deactivate all others first
            await Event.updateMany({ _id: { $ne: eventId } }, { active: false });
        }

        await Event.findByIdAndUpdate(eventId, {
            active,
            "settings.askName": askName,
            "settings.askTable": askTable,
            "settings.defaultCashierPrinterIp": defaultCashierPrinterIp
        });
        revalidatePath("/admin/settings/events");
    }

    async function deleteEvent(formData: FormData) {
        "use server"
        const eventId = formData.get("eventId") as string;
        if (!eventId) return;

        await dbConnect();
        // Cascade delete: Event -> Categories -> Products
        await Product.deleteMany({ eventId });
        await Category.deleteMany({ eventId });
        await Event.findByIdAndDelete(eventId);

        revalidatePath("/admin/settings/events");
    }

    async function archiveEvent(formData: FormData) {
        "use server"
        const eventId = formData.get("eventId") as string;
        if (!eventId) return;

        await dbConnect();
        await Event.findByIdAndUpdate(eventId, {
            archived: true,
            active: false
        });
        revalidatePath("/admin/settings/events");
    }

    async function cloneEvent(formData: FormData) {
        "use server"
        const sourceEventId = formData.get("sourceEventId") as string;
        const newName = formData.get("newName") as string;
        if (!sourceEventId || !newName) return;

        await dbConnect();

        const sourceEvent = await Event.findById(sourceEventId).lean();
        if (!sourceEvent) return;

        // 1. Crea la nuova festa
        const newEvent = await Event.create({
            name: newName,
            active: false,
            archived: false,
            settings: sourceEvent.settings
        });

        // 2. Clona le Categorie
        const categories = await Category.find({ eventId: sourceEventId }).lean();
        const categoryMap = new Map(); // mappa vecchi id -> nuovi id

        for (const cat of categories) {
            const newCat = await Category.create({
                eventId: newEvent._id,
                name: cat.name,
                uiColor: cat.uiColor,
                printerIp: cat.printerIp
            });
            categoryMap.set(cat._id.toString(), newCat._id);
        }

        // 3. Clona i Prodotti associandoli alle nuove Categorie
        const products = await Product.find({ eventId: sourceEventId }).lean();
        for (const prod of products) {
            await Product.create({
                eventId: newEvent._id,
                categoryId: categoryMap.get(prod.categoryId.toString()),
                name: prod.name,
                basePrice: prod.basePrice,
                isSoldOut: false,
                variants: prod.variants
            });
        }

        revalidatePath("/admin/settings/events");
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold tracking-tight">Feste (Eventi)</h1>

                <Dialog>
                    <DialogTrigger asChild>
                        <Button id="new-event-btn">+ Nuova Festa</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <form action={createEvent}>
                            <DialogHeader>
                                <DialogTitle>Crea Nuova Festa</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="name" className="text-right">Nome</Label>
                                    <Input id="name" name="name" placeholder="Es. Sagra 2025" className="col-span-3" required />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="submit">Salva</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {events.length === 0 ? (
                <div className="border border-dashed rounded-lg p-10 text-center">
                    <p className="text-muted-foreground">Nessuna festa configurata. Creane una per iniziare.</p>
                </div>
            ) : (
                <div className="grid gap-4 mt-6">
                    {events.map((evt: any) => (
                        <div key={evt._id.toString()} className="p-4 border rounded-md shadow-sm bg-white dark:bg-slate-900 flex justify-between items-center">
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
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" size="sm">Clona</Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <form action={cloneEvent}>
                                            <input type="hidden" name="sourceEventId" value={evt._id.toString()} />
                                            <DialogHeader>
                                                <DialogTitle>Clona {evt.name}</DialogTitle>
                                            </DialogHeader>
                                            <div className="grid gap-4 py-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor={`newName-${evt._id}`}>Nome Nuova Festa</Label>
                                                    <Input id={`newName-${evt._id}`} name="newName" placeholder="Es. Sagra 2025" required />
                                                </div>
                                                <p className="text-sm text-muted-foreground">Verranno copiati tutti i prodotti, le categorie e le impostazioni della festa. Lo storico ordini partirà da zero.</p>
                                            </div>
                                            <DialogFooter>
                                                <Button type="submit">Clona Festa</Button>
                                            </DialogFooter>
                                        </form>
                                    </DialogContent>
                                </Dialog>

                                {!evt.archived && (
                                    <>
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button variant="outline" size="sm">Impostazioni</Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <form action={updateEventSettings}>
                                                    <input type="hidden" name="eventId" value={evt._id.toString()} />
                                                    <DialogHeader>
                                                        <DialogTitle>Impostazioni per {evt.name}</DialogTitle>
                                                    </DialogHeader>
                                                    <div className="grid gap-4 py-4">
                                                        <div className="flex items-center space-x-2 border-b pb-4 mb-2">
                                                            <input type="checkbox" name="active" id={`active-${evt._id}`} defaultChecked={evt.active} className="h-4 w-4 rounded border-gray-300" />
                                                            <Label htmlFor={`active-${evt._id}`} className="font-bold text-green-600 cursor-pointer">Festa Attiva (Mostra nel POS e WebApp)</Label>
                                                        </div>
                                                        <div className="flex items-center space-x-2">
                                                            <input type="checkbox" name="askName" id={`askName-${evt._id}`} defaultChecked={evt.settings?.askName} className="h-4 w-4 rounded border-gray-300" />
                                                            <Label htmlFor={`askName-${evt._id}`}>Chiedi Nome Cliente</Label>
                                                        </div>
                                                        <div className="flex items-center space-x-2">
                                                            <input type="checkbox" name="askTable" id={`askTable-${evt._id}`} defaultChecked={evt.settings?.askTable} className="h-4 w-4 rounded border-gray-300" />
                                                            <Label htmlFor={`askTable-${evt._id}`}>Chiedi Numero Tavolo</Label>
                                                        </div>
                                                        <div className="grid gap-2 pt-2">
                                                            <Label htmlFor={`cashierIp-${evt._id}`}>IP Stampante Cassa Predefinito</Label>
                                                            <Input id={`cashierIp-${evt._id}`} name="defaultCashierPrinterIp" defaultValue={evt.settings?.defaultCashierPrinterIp} placeholder="192.168.1.100" />
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button type="submit">Salva Impostazioni</Button>
                                                    </DialogFooter>
                                                </form>
                                            </DialogContent>
                                        </Dialog>

                                        <ArchiveForm
                                            id={evt._id.toString()}
                                            idName="eventId"
                                            message="Questa festa non sarà più modificabile e scompariranno le impostazioni. Confermi l'archiviazione?"
                                            action={archiveEvent}
                                            buttonSize="icon"
                                            iconSize={18}
                                        />
                                    </>
                                )}

                                <DeleteForm
                                    id={evt._id.toString()}
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
