import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/components/print-document-viewer", () => ({
    PrintDocumentViewer: () => <div>Anteprima</div>
}));

import { PrintJobsMonitor } from "@/components/print-jobs-monitor";

describe("PrintJobsMonitor", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/preview")) return Response.json({}, { status: 404 });
            return Response.json({
                jobs: [{
                    id: "job-1",
                    status: "HELD",
                    source: "ORDER",
                    printType: "KITCHEN_ORDER",
                    destinationHost: "10.0.0.10",
                    destinationPort: 9100,
                    isVirtual: false,
                    copies: 1,
                    automaticRetryCount: 0,
                    document: {},
                    createdAt: "2026-08-12T07:00:00.000Z",
                    printer: {
                        id: "printer-1",
                        name: "Cucina",
                        ip: "10.0.0.10",
                        port: 9100,
                        type: "KITCHEN",
                        isVirtual: false
                    }
                }],
                heldQueues: [{
                    key: "printer-1",
                    printerId: "printer-1",
                    name: "Cucina",
                    destinationHost: "10.0.0.10",
                    destinationPort: 9100,
                    count: 2,
                    oldestHeldAt: "2026-08-12T07:00:00.000Z"
                }]
            });
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test("shows held queue counts without exposing manual retry for HELD jobs", async () => {
        render(<PrintJobsMonitor eventId="event-1" printers={[]} />);

        const queueSummary = await screen.findByTestId("held-print-queues");
        expect(queueSummary).toHaveTextContent("Code reparto in attesa");
        expect(queueSummary).toHaveTextContent("Cucina · 2 stampe");
        expect(queueSummary).toHaveTextContent("In attesa dal");
        expect(screen.getByText("IN ATTESA")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Reinvia job fallito" })).not.toBeInTheDocument();
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            "/api/admin/print-jobs?eventId=event-1&limit=40",
            { cache: "no-store" }
        ));
    });
});
