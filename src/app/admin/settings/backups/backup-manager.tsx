"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HardDrive,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  runConfiguredBackupNowAction,
  saveBackupPolicyAction,
  type BackupAdminActionState,
} from "./actions";
import type { BackupSettingsView, BackupTargetOption } from "@/lib/runtime-backup";

interface BackupManagerProps {
  initialSettings: BackupSettingsView;
  targets: BackupTargetOption[];
  targetsRoot: string | null;
  downloadUrl: string;
  restoreUrl: string;
}

type FeedbackState = {
  type: "success" | "error";
  message: string;
} | null;

type RestoreApiResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  settings?: BackupSettingsView;
};

function formatTimestamp(value?: string) {
  if (!value) return "Mai";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

export function BackupManager({
  initialSettings,
  targets,
  targetsRoot,
  downloadUrl,
  restoreUrl,
}: BackupManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRestorePending, setIsRestorePending] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [periodicEnabled, setPeriodicEnabled] = useState(initialSettings.periodicEnabled);
  const [intervalHours, setIntervalHours] = useState(String(initialSettings.intervalHours));
  const [retentionCount, setRetentionCount] = useState(String(initialSettings.retentionCount));
  const [targetRelativePath, setTargetRelativePath] = useState(initialSettings.targetRelativePath || "");
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);
  const [restoreFileName, setRestoreFileName] = useState("");

  useEffect(() => {
    setSettings(initialSettings);
    setPeriodicEnabled(initialSettings.periodicEnabled);
    setIntervalHours(String(initialSettings.intervalHours));
    setRetentionCount(String(initialSettings.retentionCount));
    setTargetRelativePath(initialSettings.targetRelativePath || "");
  }, [initialSettings]);

  function applyResult(result: BackupAdminActionState | undefined) {
    if (!result) return;
    if (result.settings) {
      setSettings(result.settings);
      setPeriodicEnabled(result.settings.periodicEnabled);
      setIntervalHours(String(result.settings.intervalHours));
      setRetentionCount(String(result.settings.retentionCount));
      setTargetRelativePath(result.settings.targetRelativePath || "");
    }
    if (result.error) {
      setFeedback({ type: "error", message: result.error });
      return;
    }
    if (result.success) {
      setFeedback({ type: "success", message: result.success });
    }
  }

  async function handleSavePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const formData = new FormData();
    if (periodicEnabled) {
      formData.set("periodicEnabled", "on");
    }
    formData.set("intervalHours", intervalHours);
    formData.set("retentionCount", retentionCount);
    formData.set("targetRelativePath", targetRelativePath);
    startTransition(async () => {
      const result = await saveBackupPolicyAction(formData);
      applyResult(result);
    });
  }

  function handleRunConfiguredBackupNow() {
    setFeedback(null);
    startTransition(async () => {
      const result = await runConfiguredBackupNowAction();
      applyResult(result);
    });
  }

  async function handleRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const file = restoreFileInputRef.current?.files?.[0] || null;
    if (!file) {
      setFeedback({ type: "error", message: "Seleziona un file backup valido da ripristinare." });
      return;
    }

    if (confirmation.trim().toUpperCase() !== "RIPRISTINA") {
      setFeedback({
        type: "error",
        message: "Conferma digitando RIPRISTINA prima di avviare il restore.",
      });
      return;
    }

    const formData = new FormData();
    formData.set("bundleFile", file);
    formData.set("confirmation", confirmation);

    setIsRestorePending(true);
    try {
      const response = await fetch(restoreUrl, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as RestoreApiResponse | null;

      if (!response.ok || !payload?.ok) {
        setFeedback({
          type: "error",
          message: payload?.error || "Errore durante il ripristino del backup.",
        });
        return;
      }

      if (payload.settings) {
        applyResult({ success: payload.message, settings: payload.settings });
      } else {
        setFeedback({
          type: "success",
          message: payload.message || "Ripristino completato.",
        });
      }

      setConfirmation("");
      setRestoreFileName("");
      if (restoreFileInputRef.current) {
        restoreFileInputRef.current.value = "";
      }
      router.refresh();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Errore durante il ripristino del backup.",
      });
    } finally {
      setIsRestorePending(false);
    }
  }

  const selectedTarget = targets.find((target) => target.relativePath === targetRelativePath);
  const hasConfiguredTarget = targetRelativePath.length > 0;
  const hasWritableConfiguredTarget = !hasConfiguredTarget || Boolean(selectedTarget?.writable);
  const isBusy = isPending || isRestorePending;

  return (
    <div className="space-y-6">
      {feedback ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm shadow-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <div className="flex items-start gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4" />
            )}
            <span>{feedback.message}</span>
          </div>
        </div>
      ) : null}

      <Card className="border-2 border-primary/10 shadow-lg">
        <CardHeader className="border-b bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-2 text-white">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">Policy backup periodico</CardTitle>
              <CardDescription>
                Configura il salvataggio automatico del runtime verso una directory host montata nel container, tipicamente una chiavetta USB.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 py-6">
          <form className="grid gap-6" onSubmit={handleSavePolicy}>
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-4 rounded-xl border p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="periodicEnabled"
                    checked={periodicEnabled}
                    onChange={(inputEvent) => setPeriodicEnabled(inputEvent.currentTarget.checked)}
                    className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <div className="space-y-1">
                    <Label htmlFor="periodicEnabled" className="cursor-pointer text-sm font-semibold">
                      Abilita backup periodico
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Il job gira nel backoffice e salva bundle completi DB + upload sulla destinazione configurata.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="intervalHours">Intervallo (ore)</Label>
                    <Input
                      id="intervalHours"
                      inputMode="numeric"
                      min={1}
                      max={720}
                      value={intervalHours}
                      onChange={(event) => setIntervalHours(event.currentTarget.value)}
                      disabled={isBusy}
                    />
                    <p className="text-xs text-muted-foreground">Esempi: `6`, `12`, `24`.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="retentionCount">Retention bundle</Label>
                    <Input
                      id="retentionCount"
                      inputMode="numeric"
                      min={1}
                      max={365}
                      value={retentionCount}
                      onChange={(event) => setRetentionCount(event.currentTarget.value)}
                      disabled={isBusy}
                    />
                    <p className="text-xs text-muted-foreground">
                      Quanti backup tenere nella destinazione selezionata.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border p-4 shadow-sm">
                <div className="space-y-2">
                  <Label htmlFor="targetRelativePath">Destinazione output</Label>
                  <select
                    id="targetRelativePath"
                    value={targetRelativePath}
                    onChange={(event) => setTargetRelativePath(event.currentTarget.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    disabled={isBusy}
                  >
                    <option value="">Seleziona una destinazione</option>
                    {targets.map((target) => (
                      <option key={target.relativePath} value={target.relativePath}>
                        {target.label}
                        {target.writable ? "" : " (sola lettura)"}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Root host montata: {targetsRoot || "non configurata"}
                  </p>
                </div>

                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-700">Destinazioni rilevate</p>
                  {targets.length === 0 ? (
                    <p className="mt-2">
                      Nessuna directory disponibile. Monta una root host per i backup nel container e ricarica la pagina dopo aver inserito la chiavetta.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {targets.map((target) => (
                        <li key={target.relativePath}>
                          <span className="font-medium">{target.label}</span>
                          {target.writable ? "" : " - sola lettura"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                disabled={isBusy || (periodicEnabled && (!hasConfiguredTarget || !hasWritableConfiguredTarget))}
                className="gap-2"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salva policy
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => router.refresh()}
                disabled={isBusy}
              >
                <RefreshCw className="h-4 w-4" />
                Aggiorna periferiche
              </Button>
            </div>
          </form>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Ultimo backup sulla destinazione</p>
              <dl className="mt-3 grid gap-2 text-sm text-slate-700">
                <div className="flex justify-between gap-3">
                  <dt>Stato</dt>
                  <dd className="font-medium">{settings.lastRunStatus}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Ultimo trigger</dt>
                  <dd className="font-medium">{settings.lastTrigger || "-"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Avvio</dt>
                  <dd className="font-medium">{formatTimestamp(settings.lastRunStartedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Fine</dt>
                  <dd className="font-medium">{formatTimestamp(settings.lastRunFinishedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Ultimo successo</dt>
                  <dd className="font-medium">{formatTimestamp(settings.lastSuccessAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Bundle</dt>
                  <dd className="break-all text-right font-medium">{settings.lastBundleName || "-"}</dd>
                </div>
              </dl>
              {settings.lastRunMessage ? (
                <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {settings.lastRunMessage}
                </p>
              ) : null}
            </div>

            <div className="rounded-xl border p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Ultimo restore</p>
              <dl className="mt-3 grid gap-2 text-sm text-slate-700">
                <div className="flex justify-between gap-3">
                  <dt>Stato</dt>
                  <dd className="font-medium">{settings.lastRestoreStatus || "-"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Ultima esecuzione</dt>
                  <dd className="font-medium">{formatTimestamp(settings.lastRestoreAt)}</dd>
                </div>
              </dl>
              {settings.lastRestoreMessage ? (
                <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {settings.lastRestoreMessage}
                </p>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  Nessun restore eseguito da questa interfaccia.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Card className="border-2 border-emerald-100 shadow-lg">
          <CardHeader className="border-b bg-emerald-50">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-600 p-2 text-white">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Backup manuale</CardTitle>
                <CardDescription>
                  Scarica subito un bundle completo direttamente dal browser oppure salvalo sulla destinazione configurata.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 py-6">
            <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900">
              Il download manuale non dipende dalla destinazione USB. Genera un bundle completo dell&apos;applicazione e lo restituisce come file.
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <a href={downloadUrl}>
                  <Download className="h-4 w-4" />
                  Scarica backup ora
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={isBusy || !hasConfiguredTarget || !hasWritableConfiguredTarget}
                onClick={handleRunConfiguredBackupNow}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
                Esegui backup ora sulla destinazione
              </Button>
            </div>
            {!hasConfiguredTarget ? (
              <p className="text-xs text-muted-foreground">
                Per il salvataggio su dispositivo devi prima selezionare una destinazione nella policy.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-2 border-amber-100 shadow-lg">
          <CardHeader className="border-b bg-amber-50">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-600 p-2 text-white">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Restore manuale</CardTitle>
                <CardDescription>
                  Ripristina DB e upload da un bundle caricato manualmente dall&apos;amministratore.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 py-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-semibold">Operazione distruttiva</p>
                  <p className="mt-1 text-xs leading-5 text-amber-900/90">
                    Il restore sovrascrive tutte le collection applicative e la cartella `public/uploads`. Usalo solo in finestra di manutenzione.
                  </p>
                </div>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleRestore}>
              <div className="space-y-2">
                <Label htmlFor="bundleFile">File backup</Label>
                <Input
                  id="bundleFile"
                  ref={restoreFileInputRef}
                  type="file"
                  accept=".tar.gz,application/gzip,application/x-gzip"
                  onChange={(event) => setRestoreFileName(event.currentTarget.files?.[0]?.name || "")}
                  disabled={isBusy}
                />
                <p className="text-xs text-muted-foreground">
                  Seleziona un bundle `tar.gz` generato da questa area admin.
                </p>
                {restoreFileName ? (
                  <p className="text-xs text-slate-700">File selezionato: {restoreFileName}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmation">Conferma</Label>
                <Input
                  id="confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                  placeholder="Digita RIPRISTINA"
                  disabled={isBusy}
                />
              </div>
              <Button type="submit" variant="destructive" className="gap-2" disabled={isBusy}>
                {isRestorePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Avvia restore
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
