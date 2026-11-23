"use client";

import { Button } from "@/components/ui/button";
import { useFormStatus } from "react-dom";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Provisioning..." : "Provisiona 10 virtuali"}
        </Button>
    );
}

export function ProvisionVirtualPrintersForm({
    eventId,
    action
}: {
    eventId: string;
    action: (formData: FormData) => Promise<{ error?: string } | undefined | void>;
}) {
    async function handleSubmit(formData: FormData) {
        const result = await action(formData);
        if (result?.error) alert(result.error);
    }

    return (
        <form action={handleSubmit}>
            <input type="hidden" name="eventId" value={eventId} />
            <SubmitButton />
        </form>
    );
}
