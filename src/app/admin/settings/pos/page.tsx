import Link from "next/link";
import { getAdminContextEventId } from "@/lib/events";
import dbConnect from "@/lib/mongoose";
import PosDevice, { IPosDevice } from "@/models/PosDevice";
import Printer, { IPrinter } from "@/models/Printer";
import Peripheral, { IPeripheral } from "@/models/Peripheral";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Monitor, ArrowLeft } from "lucide-react";
import { DeleteForm } from "@/components/delete-form";
import { deletePosDeviceAction, createPosDeviceAction, updatePosDeviceAction } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { HardwareDialog } from "@/components/hardware-dialog";
import { HardwareFormWrapper } from "@/components/hardware-form-wrapper";
import { EditPosDeviceDialog } from "@/components/edit-pos-device-dialog";

function getReferencedId(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === "object" && "_id" in value) {
        const populated = value as { _id?: unknown };
        return populated._id ? String(populated._id) : undefined;
    }
    return String(value);
}

export default async function PosDevicesPage() {
    const eventId = await getAdminContextEventId();
    if (!eventId) return <div>Seleziona una festa prima.</div>;

    await dbConnect();
    const posDevices = await PosDevice.find({ eventId }).populate('printerId').lean();
    const cashierPrinters = await Printer.find({ eventId, type: 'CASHIER' }).lean();
    const peripherals = await Peripheral.find({ eventId }).sort({ name: 1 }).lean();

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
                    <HardwareDialog
                        title="Aggiungi Punto Cassa"
                        buttonText="Nuovo Dispositivo"
                    >
                        {cashierPrinters.length > 0 ? (
                            <HardwareFormWrapper action={createPosDeviceAction}>
                                <input type="hidden" name="eventId" value={eventId} />
                                <div className="space-y-2">
                                    <Label htmlFor="name">Nome Postazione</Label>
                                    <Input id="name" name="name" placeholder="Es: Cassa Centrale, Bar..." required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="printer-select">Stampante Associata</Label>
                                    <Select name="printerId" required>
                                        <SelectTrigger id="printer-select" aria-label="Stampante Associata">
                                            <SelectValue placeholder="Seleziona stampante" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {cashierPrinters.map((p: IPrinter) => (
                                                <SelectItem key={String(p._id)} value={String(p._id)}>
                                                    {p.name} ({p.ip})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">Verranno mostrate solo le stampanti di tipo &quot;Cassa&quot;.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="terminal-select">Terminale Pagamento (Elettronico)</Label>
                                    <Select name="paymentTerminalId">
                                        <SelectTrigger id="terminal-select">
                                            <SelectValue placeholder="Nessuno" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Nessuno</SelectItem>
                                            {peripherals.filter((p: IPeripheral) => p.type === 'SUMUP').map((p: IPeripheral) => (
                                                <SelectItem key={String(p._id)} value={String(p._id)}>
                                                    {p.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="cashbox-select">Cassetta Contanti (Manuale)</Label>
                                    <Select name="cashBoxId">
                                        <SelectTrigger id="cashbox-select">
                                            <SelectValue placeholder="Nessuna" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Nessuna</SelectItem>
                                            {peripherals.filter((p: IPeripheral) => p.type === 'CASH_BOX').map((p: IPeripheral) => (
                                                <SelectItem key={String(p._id)} value={String(p._id)}>
                                                    {p.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </HardwareFormWrapper>
                        ) : (
                            <p className="text-sm text-destructive font-medium p-4">Configura almeno una stampante &quot;Cassa&quot; per aggiungere dispositivi.</p>
                        )}
                    </HardwareDialog>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {posDevices.map((device: IPosDevice) => (
                    <Card key={String(device._id)}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-lg font-bold">{device.name}</CardTitle>
                            <div className="p-2 rounded-full bg-blue-100 text-blue-600">
                                <Monitor className="h-5 w-5" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-sm text-muted-foreground mb-4">
                                <p>Stampante associata: <span className="font-medium text-foreground">{(device.printerId as unknown as IPrinter)?.name || "Non collegata"}</span></p>
                                <p>Terminale: <span className="font-medium text-foreground">{peripherals.find(p => String(p._id) === String(device.paymentTerminalId))?.name || "Nessuno"}</span></p>
                                <p>Cassetta: <span className="font-medium text-foreground">{peripherals.find(p => String(p._id) === String(device.cashBoxId))?.name || "Nessuna"}</span></p>
                            </div>
                            <div className="flex justify-end gap-2 mt-4">
                                <EditPosDeviceDialog
                                    posDevice={{
                                        id: String(device._id),
                                        name: device.name,
                                        printerId: getReferencedId(device.printerId) || "",
                                        paymentTerminalId: String(device.paymentTerminalId || ""),
                                        cashBoxId: String(device.cashBoxId || "")
                                    }}
                                    printers={cashierPrinters.map(p => ({ id: String(p._id), name: p.name }))}
                                    peripherals={peripherals.map((p: IPeripheral) => ({ id: String(p._id), name: p.name, type: p.type }))}
                                    updateAction={updatePosDeviceAction}
                                />
                                <DeleteForm
                                    id={String(device._id)}
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
