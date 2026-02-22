"use client"

import { Button } from "@/components/ui/button"
import { Delete } from "lucide-react"

interface NumPadProps {
    value: string
    onChange: (val: string) => void
    maxLength?: number
}

export function NumPad({ value, onChange, maxLength = 4 }: NumPadProps) {
    const numbers = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]

    const handlePress = (num: string) => {
        if (value.length < maxLength) onChange(value + num)
    }

    const handleClear = () => onChange("")

    const handleDelete = () => onChange(value.slice(0, -1))

    return (
        <div className="grid grid-cols-3 gap-2 w-full max-w-[300px] mx-auto">
            {numbers.map(n => (
                <Button
                    key={n}
                    variant="outline"
                    className="h-16 text-2xl font-bold"
                    onClick={() => handlePress(n)}
                >
                    {n}
                </Button>
            ))}
            <Button variant="outline" className="h-16 text-xl font-bold bg-slate-50" onClick={handleClear}>CLR</Button>
            <Button variant="outline" className="h-16 text-2xl font-bold" onClick={() => handlePress("0")}>0</Button>
            <Button variant="outline" className="h-16 text-red-500" onClick={handleDelete}>
                <Delete />
            </Button>
        </div>
    )
}
