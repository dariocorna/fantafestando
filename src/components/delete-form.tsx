"use client"

import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function DeleteForm({
    id,
    idName = "id",
    hiddenFields = [],
    message,
    action,
    buttonSize = "sm",
    iconSize = 18
}: {
    id: string,
    idName?: string,
    hiddenFields?: Array<{ name: string; value: string }>,
    message: string,
    action: (formData: FormData) => Promise<unknown> | unknown,
    buttonSize?: "default" | "sm" | "lg" | "icon" | "xs",
    iconSize?: number
}) {
    async function handleAction(formData: FormData) {
        const result = await action(formData)
        if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
            alert(result.error)
        }
    }

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button
                    variant="ghost"
                    size={buttonSize}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    aria-label="Elimina"
                    title="Elimina"
                >
                    <Trash2 size={iconSize} />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Sei sicuro di voler procedere?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {message}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                    <form action={handleAction}>
                        <input type="hidden" name={idName} value={id} />
                        {hiddenFields.map(field => (
                            <input key={field.name} type="hidden" name={field.name} value={field.value} />
                        ))}
                        <AlertDialogAction type="submit" className="bg-red-600 hover:bg-red-700 text-white">
                            Continua
                        </AlertDialogAction>
                    </form>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
