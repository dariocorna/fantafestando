import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import { getAdminContextEventId } from "@/lib/events";
import PrintJob, { type PrintJobStatus } from "@/models/PrintJob";
import "@/models/Printer"; // Import to register schema for .populate()
import { PrinterService } from "@/lib/printer";
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz";

const allowedPrintTypes = new Set(["CUSTOMER_ORDER", "KITCHEN_ORDER", "CASHIER_SUMMARY", "CASH_SESSION_SUMMARY", "EASTER_EGG_IMAGE", "MANUAL_TEST"]);

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

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return adminUnauthorizedJson(sessionCheck);

        const contextEventId = await getAdminContextEventId();
        if (!contextEventId) {
            return NextResponse.json({ error: "Nessuna festa selezionata" }, { status: 400 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "ID job mancante" }, { status: 400 });
        }

        await dbConnect();
        const job = await PrintJob.findOne({ _id: id, eventId: contextEventId })
            .populate("printerId", "name ip port type isVirtual emulatorSlot")
            .lean() as (
                {
                    _id: { toString(): string } | string;
                    source: "ORDER" | "CASH_SESSION" | "MANUAL_TEST";
                    printType?: "CUSTOMER_ORDER" | "KITCHEN_ORDER" | "CASHIER_SUMMARY" | "CASH_SESSION_SUMMARY" | "EASTER_EGG_IMAGE" | "MANUAL_TEST";
                    status: PrintJobStatus;
                    destinationHost: string;
                    destinationPort: number;
                    isVirtual: boolean;
                    copies: number;
                    automaticRetryCount?: number;
                    document: Record<string, unknown>;
                    rawCapturePath?: string;
                    errorMessage?: string;
                    createdAt?: Date;
                    updatedAt?: Date;
                    printerId?: unknown;
                } | null
            );

        if (!job) {
            return NextResponse.json({ error: "Job non trovato" }, { status: 404 });
        }

        return NextResponse.json({
            job: {
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
                createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
                updatedAt: job.updatedAt ? new Date(job.updatedAt).toISOString() : null,
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
            }
        });
    } catch (error) {
        console.error("Print Job detail API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) return adminUnauthorizedJson(sessionCheck);

        const contextEventId = await getAdminContextEventId();
        if (!contextEventId) {
            return NextResponse.json({ error: "Nessuna festa selezionata" }, { status: 400 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "ID job mancante" }, { status: 400 });
        }

        const result = await PrinterService.retryPrintJobById(contextEventId, id);
        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Print Job retry API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
