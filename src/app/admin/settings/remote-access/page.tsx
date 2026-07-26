import Link from "next/link";
import { ArrowLeft, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireAdminPageSession } from "@/lib/authz";
import { getRemoteAccessSettingsView } from "@/lib/remote-access";
import { RemoteAccessManager } from "./remote-access-manager";

export default async function RemoteAccessSettingsPage() {
  await requireAdminPageSession();
  const settings = await getRemoteAccessSettingsView();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Network className="h-4 w-4" />
            <span>Amministrazione di sistema</span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Accesso remoto</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Attiva soltanto le superfici necessarie tramite il reverse tunnel Oracle.
          </p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link href="/admin/settings">
            <ArrowLeft className="h-4 w-4" />
            Torna alle impostazioni
          </Link>
        </Button>
      </div>

      <RemoteAccessManager initialSettings={settings} />
    </div>
  );
}
