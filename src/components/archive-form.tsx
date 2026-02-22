"use client"

import { Archive } from "lucide-react"
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

export function ArchiveForm({
    id,
    idName = "id",
    message,
    action,
    buttonSize = "sm",
    iconSize = 18
}: {
    id: string,
    idName?: string,
    message: string,
    action: (formData: FormData) => void,
    buttonSize?: "default" | "sm" | "lg" | "icon" | "xs" | any,
    iconSize?: number
}) {
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="ghost" size={buttonSize} className="text-amber-600 hover:text-amber-800 hover:bg-amber-50" title="Archivia">
                    <Archive size={iconSize} />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Sei sicuro di voler archiviare?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {message}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                    <form action={action}>
                        <input type="hidden" name={idName} value={id} />
                        <AlertDialogAction type="submit" className="bg-amber-600 hover:bg-amber-700 text-white">
                            Archivia
                        </AlertDialogAction>
                    </form>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
