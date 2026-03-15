import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import { getAdminContextEventId } from "@/lib/events";
import PrintJob from "@/models/PrintJob";
import "@/models/Printer"; // Import to register schema for .populate()

const allowedStatuses = new Set(["QUEUED", "SENT", "FAILED"]);
const allowedPrintTypes = new Set(["CUSTOMER_ORDER", "KITCHEN_ORDER", "CASHIER_SUMMARY", "CASH_SESSION_SUMMARY", "EASTER_EGG_IMAGE", "MANUAL_TEST"]);

function parseLimit(value: string | null): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return 40;
    return Math.min(parsed, 200);
}

function resolvePrintType(
    value: unknown,
    source: "ORDER" | "CASH_SESSION" | "MANUAL_TEST"
): "CUSTOMER_ORDER" | "KITCHEN_ORDER" | "CASHIER_SUMMARY" | "CASH_SESSION_SUMMARY" | "EASTER_EGG_IMAGE" | "MANUAL_TEST" {
    if (typeof value === "string" && allowedPrintTypes.has(value)) {
        return value as "CUSTOMER_ORDER" | "KITCHEN_ORDER" | "CASHIER_SUMMARY" | "CASH_SESSION_SUMMARY" | "EASTER_EGG_IMAGE" | "MANUAL_TEST";
    }
    if (source === "CASH_SESSION") return "CASH_SESSION_SUMMARY";
    if (source === "MANUAL_TEST") return "MANUAL_TEST";
    return "CUSTOMER_ORDER";
}

export async function GET(request: NextRequest) {
    try {
        const contextEventId = await getAdminContextEventId();
        if (!contextEventId) {
            return NextResponse.json({ error: "Nessuna festa selezionata" }, { status: 400 });
        }

        const requestedEventId = request.nextUrl.searchParams.get("eventId")?.trim();
        if (requestedEventId && requestedEventId !== contextEventId) {
            return NextResponse.json({ error: "Contesto festa non valido" }, { status: 403 });
        }

        const status = request.nextUrl.searchParams.get("status")?.trim() || "";
        const printerId = request.nextUrl.searchParams.get("printerId")?.trim() || "";
        const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

        const query: Record<string, unknown> = {
            eventId: contextEventId
        };

        if (status && allowedStatuses.has(status)) {
            query.status = status;
        }

        if (printerId) {
            query.printerId = printerId;
        }

        await dbConnect();
        const jobs = await PrintJob.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate("printerId", "name ip port type isVirtual emulatorSlot")
            .lean() as Array<{
                _id: { toString(): string } | string;
                source: "ORDER" | "CASH_SESSION" | "MANUAL_TEST";
                printType?: "CUSTOMER_ORDER" | "KITCHEN_ORDER" | "CASHIER_SUMMARY" | "CASH_SESSION_SUMMARY" | "EASTER_EGG_IMAGE" | "MANUAL_TEST";
                status: "QUEUED" | "SENT" | "FAILED";
                destinationHost: string;
                destinationPort: number;
                isVirtual: boolean;
                copies: number;
                automaticRetryCount?: number;
                document: Record<string, unknown>;
                rawCapturePath?: string;
                errorMessage?: string;
                createdAt?: Date;
                printerId?: unknown;
            }>;

        const serializedJobs = jobs.map((job) => ({
            id: job._id.toString(),
            source: job.source,
            printType: resolvePrintType(job.printType, job.source),
            status: job.status,
            destinationHost: job.destinationHost,
            destinationPort: job.destinationPort,
            isVirtual: job.isVirtual,
            copies: job.copies,
            automaticRetryCount: Number(job.automaticRetryCount || 0),
            document: job.document || {},
            rawCapturePath: job.rawCapturePath,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : new Date(0).toISOString(),
            printer: job.printerId && typeof job.printerId === "object"
                ? {
                    id: String((job.printerId as { _id?: unknown })._id || ""),
                    name: (job.printerId as { name?: string }).name || "",
                    ip: (job.printerId as { ip?: string }).ip || "",
                    port: (job.printerId as { port?: number }).port || 9100,
                    type: ((job.printerId as { type?: "CASHIER" | "KITCHEN" }).type || "KITCHEN"),
                    isVirtual: Boolean((job.printerId as { isVirtual?: boolean }).isVirtual),
                    emulatorSlot: (job.printerId as { emulatorSlot?: number }).emulatorSlot
                }
                : null
        }));

        return NextResponse.json({ jobs: serializedJobs });
    } catch (error) {
        console.error("Print Jobs API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
