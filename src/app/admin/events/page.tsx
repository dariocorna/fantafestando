import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import { Button } from "@/components/ui/button";
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

        revalidatePath("/admin/events");
    }

    async function updateEventSettings(formData: FormData) {
        "use server"
        const eventId = formData.get("eventId") as string;
        const askName = formData.get("askName") === "on";
        const askTable = formData.get("askTable") === "on";
        const defaultCashierPrinterIp = formData.get("defaultCashierPrinterIp") as string;

        if (!eventId) return;

        await dbConnect();
        await Event.findByIdAndUpdate(eventId, {
            "settings.askName": askName,
            "settings.askTable": askTable,
            "settings.defaultCashierPrinterIp": defaultCashierPrinterIp
        });
        revalidatePath("/admin/events");
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
                                <h3 className="font-semibold text-lg">{evt.name}</h3>
                                <div className="flex gap-4 mt-1">
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${evt.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                        {evt.active ? "Attiva" : "Inattiva"}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                        Fields: {evt.settings.askName ? 'Name' : ''} {evt.settings.askTable ? 'Table' : ''} {(!evt.settings.askName && !evt.settings.askTable) ? 'None' : ''}
                                    </span>
                                </div>
                            </div>
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm">Settings</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <form action={updateEventSettings}>
                                        <input type="hidden" name="eventId" value={evt._id.toString()} />
                                        <DialogHeader>
                                            <DialogTitle>Settings for {evt.name}</DialogTitle>
                                        </DialogHeader>
                                        <div className="grid gap-4 py-4">
                                            <div className="flex items-center space-x-2">
                                                <input type="checkbox" name="askName" id={`askName-${evt._id}`} defaultChecked={evt.settings.askName} className="h-4 w-4 rounded border-gray-300" />
                                                <Label htmlFor={`askName-${evt._id}`}>Ask Customer Name</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <input type="checkbox" name="askTable" id={`askTable-${evt._id}`} defaultChecked={evt.settings.askTable} className="h-4 w-4 rounded border-gray-300" />
                                                <Label htmlFor={`askTable-${evt._id}`}>Ask Table Number</Label>
                                            </div>
                                            <div className="grid gap-2">
                                                <Label htmlFor={`cashierIp-${evt._id}`}>Default Cashier Printer IP</Label>
                                                <Input id={`cashierIp-${evt._id}`} name="defaultCashierPrinterIp" defaultValue={evt.settings.defaultCashierPrinterIp} placeholder="192.168.1.100" />
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button type="submit">Save Settings</Button>
                                        </DialogFooter>
                                    </form>
                                </DialogContent>
                            </Dialog>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
