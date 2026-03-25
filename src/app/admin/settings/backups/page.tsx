import Link from "next/link";
import { ArrowLeft, DatabaseBackup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireAdminPageSession } from "@/lib/authz";
import { getBackupAdminPageData } from "@/lib/runtime-backup";
import { BackupManager } from "./backup-manager";

export default async function AdminBackupSettingsPage() {
  await requireAdminPageSession();
  const backupData = await getBackupAdminPageData();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <DatabaseBackup className="h-4 w-4" />
            <span>Amministrazione di sistema</span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Backup e Ripristino</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Gestisci la policy periodica, scegli la destinazione su storage esterno e lancia backup o restore manuali del runtime.
          </p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link href="/admin/settings">
            <ArrowLeft className="h-4 w-4" />
            Torna alle impostazioni
          </Link>
        </Button>
      </div>

      <BackupManager
        initialSettings={backupData.settings}
        targets={backupData.targets}
        targetsRoot={backupData.targetsRoot}
        downloadUrl={backupData.downloadUrl}
        restoreUrl={backupData.restoreUrl}
      />
    </div>
  );
}
