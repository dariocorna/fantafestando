import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Calendar } from "lucide-react";

export default function AdminSettings() {
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Impostazioni</h1>
            <p className="text-muted-foreground">Configurazione sistema, utenti e stampanti.</p>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Link href="/admin/settings/events">
                    <Card className="hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                        <CardHeader className="flex flex-row items-center gap-4">
                            <Calendar className="h-8 w-8 text-primary" />
                            <div>
                                <CardTitle>Gestione Feste</CardTitle>
                                <CardDescription>Crea, archivia e configura le edizioni dell'evento.</CardDescription>
                            </div>
                        </CardHeader>
                    </Card>
                </Link>
            </div>
        </div>
    );
}
