"use client"

import { useState, createContext, useContext, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Plus } from "lucide-react"

interface HardwareDialogContextType {
    close: () => void
}

const HardwareDialogContext = createContext<HardwareDialogContextType | undefined>(undefined)
const subscribeToClientReady = () => () => {}
const getClientReadySnapshot = () => true
const getServerReadySnapshot = () => false

export function useHardwareDialog() {
    const context = useContext(HardwareDialogContext)
    if (!context) {
        throw new Error("useHardwareDialog must be used within a HardwareDialog")
    }
    return context
}

interface HardwareDialogProps {
    title: string
    buttonText: string
    children: React.ReactNode
}

export function HardwareDialog({ title, buttonText, children }: HardwareDialogProps) {
    const [open, setOpen] = useState(false)
    const clientReady = useSyncExternalStore(
        subscribeToClientReady,
        getClientReadySnapshot,
        getServerReadySnapshot
    )

    return (
        <HardwareDialogContext.Provider value={{ close: () => setOpen(false) }}>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button className="gap-2" disabled={!clientReady}>
                        <Plus className="h-4 w-4" /> {buttonText}
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                    </DialogHeader>
                    {children}
                </DialogContent>
            </Dialog>
        </HardwareDialogContext.Provider>
    )
}
