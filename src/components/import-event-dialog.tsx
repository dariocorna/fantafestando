"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ImportEventDialogProps {
  importUrl: string;
}

type ImportEventResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  result?: {
    newEventId: string;
    newEventName: string;
    imported: {
      printers: number;
      peripherals: number;
      categories: number;
      products: number;
      posDevices: number;
    };
  };
};

type FeedbackState =
  | {
      type: "success" | "error";
      message: string;
    }
  | null;

export function ImportEventDialog({ importUrl }: ImportEventDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [newEventName, setNewEventName] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function resetFormState() {
    setNewEventName("");
    setFeedback(null);
    setSelectedFileName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const bundleFile = fileInputRef.current?.files?.[0] || null;
    if (!bundleFile) {
      setFeedback({ type: "error", message: "Seleziona un file export festa valido." });
      return;
    }

    if (!newEventName.trim()) {
      setFeedback({ type: "error", message: "Inserisci il nome della nuova festa." });
      return;
    }

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("bundleFile", bundleFile);
        formData.set("newEventName", newEventName.trim());

        const response = await fetch(importUrl, {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json().catch(() => null)) as ImportEventResponse | null;

        if (!response.ok || !payload?.ok || !payload.result) {
          setFeedback({
            type: "error",
            message: payload?.error || "Errore durante l'importazione della festa.",
          });
          return;
        }

        setFeedback({
          type: "success",
          message:
            payload.message ||
            `Festa importata: ${payload.result.newEventName} (${payload.result.imported.products} prodotti).`,
        });
        setNewEventName("");
        setSelectedFileName("");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        router.refresh();
      } catch (error) {
        setFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Errore durante l'importazione della festa.",
        });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetFormState();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4" />
          Importa Festa
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Importa Festa da File</DialogTitle>
            <DialogDescription>
              Importa configurazione, prodotti, categorie, casse, stampanti e asset gestiti. Ordini, sessioni cassa e storico operativo non vengono inclusi.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="event-transfer-file">File export festa</Label>
            <Input
              id="event-transfer-file"
              ref={fileInputRef}
              type="file"
              accept=".tar.gz,application/gzip,application/x-gzip"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] || null;
                setSelectedFileName(file?.name || "");
              }}
            />
            <p className="text-xs text-muted-foreground">
              Bundle `.tar.gz` generato dall&apos;export della singola festa.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="event-transfer-name">Nome nuova festa</Label>
            <Input
              id="event-transfer-name"
              value={newEventName}
              onChange={(event) => setNewEventName(event.currentTarget.value)}
              placeholder="Es. Sagra 2027"
              required
            />
            <p className="text-xs text-muted-foreground">
              L&apos;import crea sempre una nuova festa inattiva. Non modifica la festa sorgente e non sovrascrive quella esistente.
            </p>
          </div>

          {selectedFileName ? (
            <p className="text-xs text-muted-foreground">File selezionato: {selectedFileName}</p>
          ) : null}

          {feedback ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                feedback.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
              role="status"
            >
              {feedback.message}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Avvia Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
