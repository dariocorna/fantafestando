import Link from "next/link";
import { getAdminContextEventId } from "@/lib/events";
import dbConnect from "@/lib/mongoose";
import Printer, { IPrinter } from "@/models/Printer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Printer as PrinterIcon, Trash2, ArrowLeft } from "lucide-react";
import { DeleteForm } from "@/components/delete-form";
import { deletePrinterAction, createPrinterAction } from "../actions";
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

export default async function PrintersPage() {
    const eventId = await getAdminContextEventId();
    if (!eventId) return <div>Seleziona una festa prima.</div>;

    await dbConnect();
    const printers = await Printer.find({ eventId }).sort({ name: 1 }).lean();

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/admin/settings">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestione Stampanti</h1>
                    <p className="text-muted-foreground">Configura le stampanti termiche ESC/POS in rete.</p>
                </div>
                <div className="ml-auto">
                    <HardwareDialog
                        title="Aggiungi Nuova Stampante"
                        buttonText="Nuova Stampante"
                    >
                        <HardwareFormWrapper action={createPrinterAction}>
                            <input type="hidden" name="eventId" value={eventId} />
                            <div className="space-y-2">
                                <Label htmlFor="name">Nome Stampante</Label>
                                <Input id="name" name="name" placeholder="Es: Cucina, Bar..." required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="ip">Indirizzo IP</Label>
                                <Input id="ip" name="ip" placeholder="192.168.1.100" required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="printer-type">Tipo Stampante</Label>
                                <Select name="type" defaultValue="KITCHEN">
                                    <SelectTrigger id="printer-type" aria-label="Tipo Stampante">
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
                                <p>IP: <span className="font-mono font-medium text-foreground">{printer.ip}</span></p>
                                <p>Tipo: <span className="font-medium text-foreground">{printer.type === 'CASHIER' ? 'Cassa' : 'Reparto'}</span></p>
                            </div>
                            <div className="flex justify-end">
                                <DeleteForm
                                    id={String(printer._id)}
                                    action={deletePrinterAction}
                                    message={`Sei sicuro di voler eliminare la stampante ${printer.name}? Verrà scollegata da tutte le categorie associate.`}
                                />
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {printers.length === 0 && (
                    <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl">
                        <p className="text-muted-foreground">Nessuna stampante configurata per questa festa.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
