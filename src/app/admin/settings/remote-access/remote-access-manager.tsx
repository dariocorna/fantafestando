"use client";

import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { RemoteAccessSettingsView } from "@/lib/remote-access";
import { saveRemoteAccessSettingsAction } from "./actions";

type SurfaceKey = "menuEnabled" | "adminEnabled" | "posEnabled" | "sshEnabled";

const SURFACES: Array<{
  key: SurfaceKey;
  appliedKey: keyof RemoteAccessSettingsView;
  title: string;
  warning: string;
}> = [
  {
    key: "menuEnabled",
    appliedKey: "appliedMenuEnabled",
    title: "Menu pubblico",
    warning: "Rende pubblici il catalogo e l’invio degli ordini.",
  },
  {
    key: "adminEnabled",
    appliedKey: "appliedAdminEnabled",
    title: "Pannello Admin",
    warning: "Espone su Internet login e funzioni gestionali. Usa una password robusta.",
  },
  {
    key: "posEnabled",
    appliedKey: "appliedPosEnabled",
    title: "POS remoto",
    warning: "Espone le funzioni di cassa agli utenti autenticati. Il login remoto è sempre obbligatorio.",
  },
  {
    key: "sshEnabled",
    appliedKey: "appliedSshEnabled",
    title: "SSH board",
    warning: "Concede accesso shell alle chiavi autorizzate. Disattivarlo può interrompere sessioni remote.",
  },
];

const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function StatusBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
        enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
      }`}
    >
      {enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {label}: {enabled ? "attivo" : "disattivo"}
    </span>
  );
}

export function RemoteAccessManager({ initialSettings }: { initialSettings: RemoteAccessSettingsView }) {
  const [settings, setSettings] = useState(initialSettings);
  const [desired, setDesired] = useState({
    menuEnabled: initialSettings.menuEnabled,
    adminEnabled: initialSettings.adminEnabled,
    posEnabled: initialSettings.posEnabled,
    sshEnabled: initialSettings.sshEnabled,
    posLanAuthenticationEnabled: initialSettings.posLanAuthenticationEnabled,
  });
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);

  function requestSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirmationOpen(true);
  }

  function save() {
    const formData = new FormData();
    for (const [key, enabled] of Object.entries(desired)) {
      if (enabled) formData.set(key, "on");
    }

    setFeedback(null);
    startTransition(async () => {
      const result = await saveRemoteAccessSettingsAction(formData);
      if (result.settings) setSettings(result.settings);
      setFeedback({
        type: result.error ? "error" : "success",
        message: result.error || result.success || "Configurazione salvata.",
      });
    });
  }

  return (
    <>
      {feedback ? (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      {settings.lastError ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong>Errore controller:</strong> {settings.lastError}
        </div>
      ) : null}

      <form className="space-y-6" onSubmit={requestSave} data-testid="remote-access-form" data-hydrated={hydrated}>
        <div className="grid gap-4 md:grid-cols-2">
          {SURFACES.map((surface) => {
            const applied = Boolean(settings[surface.appliedKey]);
            return (
              <Card key={surface.key} className="border-2 border-slate-200 shadow-sm">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg">{surface.title}</CardTitle>
                      <CardDescription className="mt-1">{surface.warning}</CardDescription>
                    </div>
                    <input
                      id={surface.key}
                      name={surface.key}
                      type="checkbox"
                      checked={desired[surface.key]}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setDesired((current) => ({ ...current, [surface.key]: checked }));
                      }}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <StatusBadge enabled={desired[surface.key]} label="Richiesto" />
                  <StatusBadge enabled={applied} label="Applicato" />
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="border-2 border-amber-200 bg-amber-50/40">
          <CardHeader>
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" />
              <div>
                <CardTitle className="text-lg">Autenticazione POS in LAN</CardTitle>
                <CardDescription>
                  Dal proxy remoto il login non può essere disabilitato. Questa opzione riguarda soltanto gli accessi locali.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3">
              <input
                id="posLanAuthenticationEnabled"
                name="posLanAuthenticationEnabled"
                type="checkbox"
                checked={desired.posLanAuthenticationEnabled}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setDesired((current) => ({ ...current, posLanAuthenticationEnabled: checked }));
                }}
                className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <div>
                <Label htmlFor="posLanAuthenticationEnabled" className="cursor-pointer font-semibold">
                  Richiedi login POS anche in LAN
                </Label>
                <p className="mt-1 text-sm text-amber-900">
                  Se disabilitato, chiunque raggiunga la board dalla rete locale può operare sulla cassa.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending || !hydrated} className="gap-2">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salva configurazione
          </Button>
        </div>
      </form>

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Conferma modifica accesso remoto
            </AlertDialogTitle>
            <AlertDialogDescription>
              L’attivazione espone nuove superfici tramite la VM pubblica. La disattivazione di Admin o SSH può interrompere il tuo accesso remoto corrente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={save}>Conferma e applica</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
