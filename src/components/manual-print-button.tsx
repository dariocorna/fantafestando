"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

export interface ManualPrintActionState {
    success?: string;
    error?: string;
}

interface ManualPrintButtonProps {
    eventId: string;
    printerId?: string;
    label?: string;
    variant?: ComponentProps<typeof Button>["variant"];
    action: (state: ManualPrintActionState, formData: FormData) => Promise<ManualPrintActionState>;
}

const INITIAL_STATE: ManualPrintActionState = {};

function SubmitButton({ label, variant }: { label: string; variant: ManualPrintButtonProps["variant"] }) {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" variant={variant} disabled={pending}>
            {pending ? "Invio..." : label}
        </Button>
    );
}

export function ManualPrintButton({
    eventId,
    printerId,
    action,
    label = "Stampa test",
    variant = "outline"
}: ManualPrintButtonProps) {
    const [state, formAction] = useActionState(action, INITIAL_STATE);

    return (
        <form action={formAction} className="flex flex-col items-start gap-2">
            <input type="hidden" name="eventId" value={eventId} />
            {printerId ? <input type="hidden" name="printerId" value={printerId} /> : null}
            <SubmitButton label={label} variant={variant} />
            {state.success ? <p className="text-xs text-emerald-700">{state.success}</p> : null}
            {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
        </form>
    );
}
