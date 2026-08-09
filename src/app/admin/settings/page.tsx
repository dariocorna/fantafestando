import Link from "next/link";
import { Calendar, DatabaseBackup, Home, Network, Printer, Settings, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { getAdminContextEvent } from "@/lib/events";
import { normalizePosCatalogLayout } from "@/lib/pos-catalog-layout";
import { resolveQuickDiscountPresetsFromSettings } from "@/lib/quick-discount-presets";
import type { IEvent } from "@/models/Event";
import { ActiveEventSettingsForm } from "./settings-form";

export default async function AdminSettings() {
  const contextEvent = (await getAdminContextEvent()) as IEvent | null;

  const serializedEvent = contextEvent
    ? {
        _id: String(contextEvent._id),
        name: contextEvent.name,
        active: contextEvent.active,
        settings: {
          askName: contextEvent.settings?.askName ?? false,
          askTable: contextEvent.settings?.askTable ?? false,
          portalEasterEggEnabled: contextEvent.settings?.portalEasterEggEnabled ?? false,
          posCatalogLayout: normalizePosCatalogLayout(contextEvent.settings?.posCatalogLayout),
          menuHeaderLogoUrl: contextEvent.settings?.menuHeaderLogoUrl || "",
          receiptHeaderLogoUrl: contextEvent.settings?.receiptHeaderLogoUrl || "",
          quickDiscountPresets: resolveQuickDiscountPresetsFromSettings(contextEvent.settings),
          timezone: contextEvent.settings?.timezone || "Europe/Rome",
          quickStaffDiscountEnabled: contextEvent.settings?.quickStaffDiscountEnabled ?? false,
          quickStaffDiscountLabel: contextEvent.settings?.quickStaffDiscountLabel || "Staff",
          quickStaffDiscountType: contextEvent.settings?.quickStaffDiscountType || "PERCENT",
          quickStaffDiscountValue: contextEvent.settings?.quickStaffDiscountValue ?? 50,
        },
        predefinedTables: Array.isArray(contextEvent.predefinedTables) ? contextEvent.predefinedTables : [],
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Impostazioni</h1>
          <p className="text-muted-foreground">Configurazione della festa attiva e parametri di sistema.</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="overflow-hidden border-2 border-primary/10 shadow-lg md:col-span-2">
          <CardHeader className="border-b bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary p-2 text-white">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">
                  Impostazioni Festa: {serializedEvent?.name || "Nessuna selezionata"}
                </CardTitle>
                <CardDescription>
                  Personalizza il comportamento del POS e della WebApp per questa edizione.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          {serializedEvent ? (
            <ActiveEventSettingsForm key={serializedEvent._id} event={serializedEvent} />
          ) : (
            <CardContent className="py-12 text-center">
              <p className="mb-4 text-muted-foreground">
                Seleziona una festa dall&apos;header per configurarne i parametri.
              </p>
              <Link href="/admin/settings/events">
                <Button variant="outline">Gestione Tutte le Feste</Button>
              </Link>
            </CardContent>
          )}
        </Card>

        <div className="grid gap-6 md:col-span-2 md:grid-cols-2 xl:grid-cols-3">
          <Link href="/admin/settings/events">
            <Card className="h-full border-2 border-transparent shadow-md transition-all hover:border-primary/20 hover:bg-slate-50 dark:hover:bg-slate-900">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="rounded-full bg-blue-100 p-3 text-blue-600">
                  <Calendar className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">Tutte le Feste</CardTitle>
                  <CardDescription>Crea, archivia e gestisci la cronologia degli eventi.</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin/settings/hardware">
            <Card className="h-full border-2 border-transparent shadow-md transition-all hover:border-primary/20 hover:bg-slate-50 dark:hover:bg-slate-900">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="rounded-full bg-green-100 p-3 text-green-600">
                  <Printer className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">Gestione Hardware</CardTitle>
                  <CardDescription>Configura stampanti, terminali SumUp e cassette contanti.</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin/settings/pos">
            <Card className="h-full border-2 border-transparent shadow-md transition-all hover:border-primary/20 hover:bg-slate-50 dark:hover:bg-slate-900">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="rounded-full bg-indigo-100 p-3 text-indigo-600">
                  <Home className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">Punti Cassa</CardTitle>
                  <CardDescription>Associa i terminali fisici alle stampanti cassa.</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin/settings/backups">
            <Card className="h-full border-2 border-transparent shadow-md transition-all hover:border-primary/20 hover:bg-slate-50 dark:hover:bg-slate-900">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="rounded-full bg-emerald-100 p-3 text-emerald-700">
                  <DatabaseBackup className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">Backup e Ripristino</CardTitle>
                  <CardDescription>Policy periodica, destinazioni USB, download manuale e restore.</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin/settings/remote-access">
            <Card className="h-full border-2 border-transparent shadow-md transition-all hover:border-primary/20 hover:bg-slate-50 dark:hover:bg-slate-900">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="rounded-full bg-cyan-100 p-3 text-cyan-700">
                  <Network className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">Accesso remoto</CardTitle>
                  <CardDescription>Gestisci proxy Menu, Admin, POS, SSH e login POS in LAN.</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin/easter-egg">
            <Card className="h-full border-2 border-transparent shadow-md transition-all hover:border-primary/20 hover:bg-slate-50 dark:hover:bg-slate-900">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="rounded-full bg-amber-100 p-3 text-amber-700">
                  <Smartphone className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">Easter Egg Mobile</CardTitle>
                  <CardDescription>Scatta da telefono, ritaglia il volto e stampa via reverse tunnel.</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
