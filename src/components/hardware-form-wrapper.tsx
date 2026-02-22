"use client"

import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { useFormStatus } from "react-dom"
import { useRef } from "react"
import { useRouter } from "next/navigation"
import { useHardwareDialog } from "./hardware-dialog"

interface HardwareFormWrapperProps {
    action: (formData: FormData) => Promise<{ success?: boolean; error?: string; name?: string } | undefined | void>
    children: React.ReactNode
}

function SubmitButton() {
    const { pending } = useFormStatus()
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : "Salva"}
        </Button>
    )
}

export function HardwareFormWrapper({ action, children }: HardwareFormWrapperProps) {
    const formRef = useRef<HTMLFormElement>(null)
    const { close } = useHardwareDialog()
    const router = useRouter()

    async function handleSubmit(formData: FormData) {
        const result = await action(formData)
        if (result?.success || result?.name) { // Adapt to different return structures
            router.refresh()
            close()
            formRef.current?.reset()
        } else if (result?.error) {
            alert(result.error)
        }
    }

    return (
        <form ref={formRef} action={handleSubmit} className="space-y-4 pt-4">
            {children}
            <DialogFooter>
                <SubmitButton />
            </DialogFooter>
        </form>
    )
}
