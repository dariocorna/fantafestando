"use client";

import { useTransition } from "react";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Printer, Loader2, CheckCircle2 } from "lucide-react";
import { updateEventSettingsAction } from "./actions";
import { useState } from "react";

import { IEvent } from "@/models/Event";

interface ActiveEventSettingsFormProps {
    event: IEvent;
}

export function ActiveEventSettingsForm({ event }: ActiveEventSettingsFormProps) {
    const [isPending, startTransition] = useTransition();
    const [saved, setSaved] = useState(false);

    async function handleSubmit(formData: FormData) {
        setSaved(false);
        startTransition(async () => {
            await updateEventSettingsAction(formData);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        });
    }

    return (
        <form action={handleSubmit}>
            <input type="hidden" name="eventId" value={String(event._id)} />
            <CardContent className="grid gap-6 py-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-slate-50 transition-colors">
                        <input
                            type="checkbox"
                            name="active"
                            id="active"
                            defaultChecked={event.active}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <div className="space-y-1 leading-none">
                            <Label htmlFor="active" className="text-sm font-bold text-green-600 cursor-pointer">
                                Festa Attiva (Mostra nel POS e WebApp)
                            </Label>
                            <p className="text-xs text-muted-foreground">Rende questa festa quella predefinita per i clienti.</p>
                        </div>
                    </div>

                    <div className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-slate-50 transition-colors">
                        <input
                            type="checkbox"
                            name="askName"
                            id="askName"
                            defaultChecked={event.settings?.askName}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <div className="space-y-1 leading-none">
                            <Label htmlFor="askName" className="text-sm font-medium cursor-pointer">
                                Chiedi Nome Cliente
                            </Label>
                            <p className="text-xs text-muted-foreground">Abilita il campo nome nel checkout della WebApp.</p>
                        </div>
                    </div>

                    <div className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-slate-50 transition-colors">
                        <input
                            type="checkbox"
                            name="askTable"
                            id="askTable"
                            defaultChecked={event.settings?.askTable}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <div className="space-y-1 leading-none">
                            <Label htmlFor="askTable" className="text-sm font-medium cursor-pointer">
                                Chiedi Numero Tavolo
                            </Label>
                            <p className="text-xs text-muted-foreground">Abilita il campo tavolo per gli ordini al posto.</p>
                        </div>
                    </div>


                    <div className="flex flex-col space-y-2 rounded-md border p-4 shadow-sm bg-blue-50/30 dark:bg-blue-900/10">
                        <Label htmlFor="sumupMerchantCode" className="text-sm font-medium">Merchant Code SumUp</Label>
                        <Input
                            id="sumupMerchantCode"
                            name="sumupMerchantCode"
                            defaultValue={event.settings?.sumupMerchantCode}
                            placeholder="M1234567"
                            className="h-9"
                        />
                    </div>

                    <div className="flex flex-col space-y-2 rounded-md border p-4 shadow-sm bg-blue-50/30 dark:bg-blue-900/10">
                        <Label htmlFor="sumupApiKey" className="text-sm font-medium">API Key SumUp</Label>
                        <Input
                            id="sumupApiKey"
                            name="sumupApiKey"
                            type="password"
                            defaultValue={event.settings?.sumupApiKey}
                            placeholder="sup_sk_..."
                            className="h-9"
                        />
                    </div>
                </div>
            </CardContent>
            <CardFooter className="bg-slate-50/50 border-t px-6 py-4 flex justify-between items-center">
                <div className="text-sm">
                    {saved && <span className="text-green-600 flex items-center gap-1 font-medium animate-in fade-in slide-in-from-left-2"><CheckCircle2 className="h-4 w-4" /> Modifiche salvate!</span>}
                </div>
                <Button type="submit" disabled={isPending} className="px-8 shadow-md">
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salva Impostazioni
                </Button>
            </CardFooter>
        </form>
    );
}
