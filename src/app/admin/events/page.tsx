import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import { Button } from "@/components/ui/button";

export default async function EventsPage() {
    await dbConnect();
    const events = await Event.find({}).lean();

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold tracking-tight">Feste (Eventi)</h1>
                <Button>+ Nuova Festa</Button>
            </div>

            {events.length === 0 ? (
                <div className="border border-dashed rounded-lg p-10 text-center">
                    <p className="text-muted-foreground">Nessuna festa configurata. Creane una per iniziare.</p>
                </div>
            ) : (
                <div className="grid gap-4 mt-6">
                    {events.map((evt: any) => (
                        <div key={evt._id.toString()} className="p-4 border rounded-md shadow-sm bg-white dark:bg-slate-900">
                            <h3 className="font-semibold text-lg">{evt.name}</h3>
                            <p className="text-sm text-gray-500">Stato: {evt.active ? "Attiva" : "Inattiva"}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
