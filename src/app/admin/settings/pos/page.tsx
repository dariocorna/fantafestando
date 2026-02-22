import Link from "next/link";
import { getAdminContextEventId } from "@/lib/events";
import dbConnect from "@/lib/mongoose";
import PosDevice from "@/models/PosDevice";
import Printer from "@/models/Printer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Monitor, Trash2, ArrowLeft } from "lucide-react";
import { DeleteForm } from "@/components/delete-form";
import { deletePosDeviceAction, createPosDeviceAction } from "../actions";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export default async function PosDevicesPage() {
    const eventId = await getAdminContextEventId();
    if (!eventId) return <div>Seleziona una festa prima.</div>;

    await dbConnect();
    const posDevices = await PosDevice.find({ eventId }).populate('printerId').lean();
    const cashierPrinters = await Printer.find({ eventId, type: 'CASHIER' }).lean();

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/admin/settings">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Punti Cassa</h1>
                    <p className="text-muted-foreground">Gestisci le postazioni fisiche di vendita.</p>
                </div>
                <div className="ml-auto">
                    {cashierPrinters.length > 0 ? (
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="gap-2">
                                    <Plus className="h-4 w-4" /> Nuovo Punto Cassa
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Aggiungi Punto Cassa</DialogTitle>
                                </DialogHeader>
                                <form action={createPosDeviceAction} className="space-y-4 pt-4">
                                    <input type="hidden" name="eventId" value={eventId} />
                                    <div className="space-y-2">
                                        <Label htmlFor="name">Nome Cassa</Label>
                                        <Input id="name" name="name" placeholder="es. Cassa 1, Cassa Bar" required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="printerId">Stampante Ricevute</Label>
                                        <Select name="printerId" required>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Seleziona stampante" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {cashierPrinters.map((p: any) => (
                                                    <SelectItem key={p._id.toString()} value={p._id.toString()}>
                                                        {p.name} ({p.ip})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">Verranno mostrate solo le stampanti di tipo "Cassa".</p>
                                    </div>
                                    <DialogFooter>
                                        <Button type="submit">Salva</Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>
                    ) : (
                        <p className="text-sm text-destructive font-medium">Configura almeno una stampante "Cassa" per aggiungere dispositivi.</p>
                    )}
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {posDevices.map((device: any) => (
                    <Card key={device._id.toString()}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-lg font-bold">{device.name}</CardTitle>
                            <div className="p-2 rounded-full bg-blue-100 text-blue-600">
                                <Monitor className="h-5 w-5" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-sm text-muted-foreground mb-4">
                                <p>Stampante associata: <span className="font-medium text-foreground">{device.printerId?.name || "Non collegata"}</span></p>
                                <p>IP Stampante: <span className="font-mono text-foreground">{device.printerId?.ip || "N/A"}</span></p>
                            </div>
                            <div className="flex justify-end">
                                <DeleteForm
                                    id={device._id.toString()}
                                    action={deletePosDeviceAction}
                                    message={`Sei sicuro di voler eliminare il Punto Cassa ${device.name}?`}
                                />
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {posDevices.length === 0 && (
                    <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl">
                        <p className="text-muted-foreground">Nessun Punto Cassa configurato.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
