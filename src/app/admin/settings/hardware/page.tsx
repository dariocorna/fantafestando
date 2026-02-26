import Link from "next/link";
import { getAdminContextEventId } from "@/lib/events";
import dbConnect from "@/lib/mongoose";
import Printer, { IPrinter } from "@/models/Printer";
import Peripheral, { IPeripheral } from "@/models/Peripheral";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer as PrinterIcon, ArrowLeft, Smartphone, Box } from "lucide-react";
import { DeleteForm } from "@/components/delete-form";
import {
    deletePrinterAction,
    createPrinterAction,
    updatePrinterAction,
    createPeripheralAction,
    updatePeripheralAction,
    deletePeripheralAction,
    provisionVirtualPrintersAction,
    createManualPrintJobAction
} from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HardwareDialog } from "@/components/hardware-dialog";
import { HardwareFormWrapper } from "@/components/hardware-form-wrapper";
import { EditPrinterDialog } from "@/components/edit-printer-dialog";
import { PeripheralDialog } from "@/components/peripheral-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PrintJobsMonitor } from "@/components/print-jobs-monitor";

export default async function HardwarePage() {
    const eventId = await getAdminContextEventId();
    if (!eventId) return <div>Seleziona una festa prima.</div>;

    async function handleProvisionVirtualPrinters(formData: FormData) {
        "use server";
        await provisionVirtualPrintersAction(formData);
    }

    async function handleCreateManualPrintJob(formData: FormData) {
        "use server";
        await createManualPrintJobAction(formData);
    }

    await dbConnect();
    const printers = await Printer.find({ eventId }).sort({ name: 1 }).lean();
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
                    <h1 className="text-3xl font-bold tracking-tight">Hardware</h1>
                    <p className="text-muted-foreground">Gestisci stampanti e periferiche di pagamento.</p>
                </div>
            </div>

            <Tabs defaultValue="printers" className="w-full">
                <TabsList className="grid w-full grid-cols-3 max-w-[560px]">
                    <TabsTrigger value="printers">Stampanti</TabsTrigger>
                    <TabsTrigger value="peripherals">Periferiche</TabsTrigger>
                    <TabsTrigger value="monitor">Monitor Stampa</TabsTrigger>
                </TabsList>

                <TabsContent value="printers" className="space-y-4 pt-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-semibold">Stampanti Termiche</h2>
                        <div className="flex items-center gap-2">
                            <form action={handleProvisionVirtualPrinters}>
                                <input type="hidden" name="eventId" value={eventId} />
                                <Button type="submit" variant="outline">Provisiona 10 virtuali</Button>
                            </form>
                            <HardwareDialog title="Aggiungi Nuova Stampante" buttonText="Nuova Stampante">
                                <HardwareFormWrapper action={createPrinterAction}>
                                    <input type="hidden" name="eventId" value={eventId} />
                                    <div className="space-y-2">
                                        <Label htmlFor="name">Nome Stampante</Label>
                                        <Input id="name" name="name" placeholder="Es: Cucina, Bar..." required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="ip">Indirizzo IP</Label>
                                        <Input id="ip" name="ip" placeholder="192.168.1.100 o printer-emulator" required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="port">Porta TCP</Label>
                                        <Input id="port" name="port" type="number" defaultValue={9100} min={1} max={65535} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="isVirtual">Stampante virtuale</Label>
                                        <input id="isVirtual" name="isVirtual" type="checkbox" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="emulatorSlot">Slot emulatore (1-10, se virtuale)</Label>
                                        <Input id="emulatorSlot" name="emulatorSlot" type="number" min={1} max={10} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="printer-type">Tipo Stampante</Label>
                                        <Select name="type" defaultValue="KITCHEN">
                                            <SelectTrigger id="printer-type">
                                                <SelectValue placeholder="Seleziona tipo" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="CASHIER">Cassa (Scontrino Cliente)</SelectItem>
                                                <SelectItem value="KITCHEN">Reparto (Comanda Piatto)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </HardwareFormWrapper>
                            </HardwareDialog>
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {printers.map((printer: IPrinter) => (
                            <Card key={String(printer._id)}>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-lg font-bold">{printer.name}</CardTitle>
                                    <div className={`p-2 rounded-full ${printer.type === 'CASHIER' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
                                        <PrinterIcon className="h-5 w-5" />
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-sm text-muted-foreground mb-4">
                                        <p>Destinazione: <span className="font-mono font-medium text-foreground">{printer.ip}:{printer.port || 9100}</span></p>
                                        <p>Tipo: <span className="font-medium text-foreground">{printer.type === 'CASHIER' ? 'Cassa' : 'Reparto'}</span></p>
                                        <p>Modalità: <span className="font-medium text-foreground">{printer.isVirtual ? "Virtuale" : "Reale"}</span></p>
                                        {printer.isVirtual && (
                                            <p>Slot: <span className="font-medium text-foreground">{printer.emulatorSlot || "-"}</span></p>
                                        )}
                                    </div>
                                    <div className="flex justify-end gap-2 mt-4">
                                        <form action={handleCreateManualPrintJob}>
                                            <input type="hidden" name="eventId" value={eventId} />
                                            <input type="hidden" name="printerId" value={String(printer._id)} />
                                            <Button type="submit" variant="outline">Stampa test</Button>
                                        </form>
                                        <EditPrinterDialog
                                            printer={{
                                                id: String(printer._id),
                                                name: printer.name,
                                                ip: printer.ip,
                                                port: printer.port || 9100,
                                                type: printer.type,
                                                isVirtual: Boolean(printer.isVirtual),
                                                emulatorSlot: printer.emulatorSlot
                                            }}
                                            eventId={eventId}
                                            updateAction={updatePrinterAction}
                                        />
                                        <DeleteForm
                                            id={String(printer._id)}
                                            action={deletePrinterAction}
                                            hiddenFields={[{ name: "eventId", value: eventId }]}
                                            message={`Sei sicuro di voler eliminare la stampante ${printer.name}?`}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="peripherals" className="space-y-4 pt-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-semibold">Periferiche di Pagamento</h2>
                        <PeripheralDialog eventId={eventId} createAction={createPeripheralAction} />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {peripherals.map((p: IPeripheral) => (
                            <Card key={String(p._id)}>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-lg font-bold">{p.name}</CardTitle>
                                    <div className={`p-2 rounded-full ${p.type === 'SUMUP' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                                        {p.type === 'SUMUP' ? <Smartphone className="h-5 w-5" /> : <Box className="h-5 w-5" />}
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-sm text-muted-foreground mb-4">
                                        <p>Tipo: <span className="font-medium text-foreground">{p.type === 'SUMUP' ? 'Terminale Elettronico (SumUp)' : 'Cassetta Contanti'}</span></p>
                                        {p.type === 'SUMUP' && <p>Merchant ID: <span className="font-mono text-foreground">{p.config?.merchantId || "Non configurato"}</span></p>}
                                    </div>
                                    <div className="flex justify-end gap-2 mt-4">
                                        <PeripheralDialog
                                            peripheral={{
                                                id: String(p._id),
                                                name: p.name,
                                                type: p.type,
                                                config: { merchantId: p.config?.merchantId as string | undefined }
                                            }}
                                            eventId={eventId}
                                            updateAction={updatePeripheralAction}
                                        />
                                        <DeleteForm
                                            id={String(p._id)}
                                            action={deletePeripheralAction}
                                            hiddenFields={[{ name: "eventId", value: eventId }]}
                                            message={`Sei sicuro di voler eliminare la periferica ${p.name}? Verrà scollegata da tutti i punti cassa.`}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="monitor" className="space-y-4 pt-4">
                    <div className="flex justify-end">
                        <form action={handleCreateManualPrintJob}>
                            <input type="hidden" name="eventId" value={eventId} />
                            {printers[0]?._id ? (
                                <input type="hidden" name="printerId" value={String(printers[0]._id)} />
                            ) : null}
                            <Button type="submit" variant="outline">Genera Ricevuta Demo</Button>
                        </form>
                    </div>
                    <PrintJobsMonitor
                        eventId={eventId}
                        printers={printers.map((printer: IPrinter) => ({
                            id: String(printer._id),
                            name: printer.name,
                            ip: printer.ip,
                            port: printer.port || 9100
                        }))}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
