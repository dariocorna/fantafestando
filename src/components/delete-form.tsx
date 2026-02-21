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
                <Button variant="ghost" size={buttonSize} className="text-red-500 hover:text-red-700 hover:bg-red-50">
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
                    <form action={action}>
                        <input type="hidden" name={idName} value={id} />
                        <AlertDialogAction type="submit" className="bg-red-600 hover:bg-red-700 text-white">
                            Continua
                        </AlertDialogAction>
                    </form>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
