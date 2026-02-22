import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../../components/ui/card";
import { Calendar, Settings, Printer, User, Home } from "lucide-react";
import { getAdminContextEvent } from "@/lib/events";
import { IEvent } from "@/models/Event";
import { Button } from "@/components/ui/button";
import { ActiveEventSettingsForm } from "./settings-form";

export default async function AdminSettings() {
    const contextEvent = await getAdminContextEvent() as IEvent | null;

    // Serialize the event object to pass to Client Component
    const serializedEvent = contextEvent
        ? {
            ...contextEvent,
            _id: String(contextEvent._id)
        }
        : null;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Impostazioni</h1>
                    <p className="text-muted-foreground">Configurazione della festa attiva e parametri di sistema.</p>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Impostazioni Festa Attiva */}
                <Card className="md:col-span-2 overflow-hidden border-2 border-primary/10 shadow-lg">
                    <CardHeader className="bg-primary/5 border-b">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary rounded-lg text-white">
                                <Settings className="h-5 w-5" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">Impostazioni Festa: {serializedEvent?.name || "Nessuna selezionata"}</CardTitle>
                                <CardDescription>Personalizza il comportamento del POS e della WebApp per questa edizione.</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    {serializedEvent ? (
                        <ActiveEventSettingsForm event={serializedEvent as any} />
                    ) : (
                        <CardContent className="py-12 text-center">
                            <p className="text-muted-foreground mb-4">Seleziona una festa dall&apos;header per configurarne i parametri.</p>
                            <Link href="/admin/settings/events">
                                <Button variant="outline">Gestione Tutte le Feste</Button>
                            </Link>
                        </CardContent>
                    )}
                </Card>

                {/* Navigazione Rapida */}
                <div className="grid gap-6 md:grid-cols-2 md:col-span-2">
                    <Link href="/admin/settings/events">
                        <Card className="hover:bg-slate-50 dark:hover:bg-slate-900 transition-all border-2 border-transparent hover:border-primary/20 shadow-md h-full">
                            <CardHeader className="flex flex-row items-center gap-4">
                                <div className="p-3 bg-blue-100 rounded-full text-blue-600">
                                    <Calendar className="h-6 w-6" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg">Tutte le Feste</CardTitle>
                                    <CardDescription>Crea, archivia e gestisci la cronologia degli eventi.</CardDescription>
                                </div>
                            </CardHeader>
                        </Card>
                    </Link>

                    <Link href="/admin/settings/printers">
                        <Card className="hover:bg-slate-50 dark:hover:bg-slate-900 transition-all border-2 border-transparent hover:border-primary/20 shadow-md h-full">
                            <CardHeader className="flex flex-row items-center gap-4">
                                <div className="p-3 bg-green-100 rounded-full text-green-600">
                                    <Printer className="h-6 w-6" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg">Hardware Stampanti</CardTitle>
                                    <CardDescription>Configura IP stampanti cucina, bar e cassa.</CardDescription>
                                </div>
                            </CardHeader>
                        </Card>
                    </Link>

                    <Link href="/admin/settings/pos">
                        <Card className="hover:bg-slate-50 dark:hover:bg-slate-900 transition-all border-2 border-transparent hover:border-primary/20 shadow-md h-full">
                            <CardHeader className="flex flex-row items-center gap-4">
                                <div className="p-3 bg-indigo-100 rounded-full text-indigo-600">
                                    <Home className="h-6 w-6" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg">Punti Cassa</CardTitle>
                                    <CardDescription>Associa i terminali fisici alle stampanti cassa.</CardDescription>
                                </div>
                            </CardHeader>
                        </Card>
                    </Link>
                </div>
            </div>
        </div>
    );
}
