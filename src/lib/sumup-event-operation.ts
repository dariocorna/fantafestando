import { randomUUID } from "node:crypto";
import Event from "@/models/Event";

const SUMUP_EVENT_OPERATION_LEASE_MS = 5 * 60 * 1000;
const SUMUP_EVENT_OPERATION_HEARTBEAT_MS = 30 * 1000;

export async function claimSumUpEventOperation(eventId: string, activeOnly = false) {
    const token = randomUUID();
    const now = new Date();
    const claimed = await Event.findOneAndUpdate(
        {
            _id: eventId,
            ...(activeOnly ? { active: true, archived: { $ne: true } } : {}),
            $or: [
                { sumupOperationClaim: { $exists: false } },
                { "sumupOperationClaim.expiresAt": { $lte: now } }
            ]
        },
        {
            $set: {
                sumupOperationClaim: {
                    token,
                    expiresAt: new Date(now.getTime() + SUMUP_EVENT_OPERATION_LEASE_MS)
                }
            }
        },
        { returnDocument: "after" }
    ).select("_id").lean();

    return claimed ? token : null;
}

export async function releaseSumUpEventOperation(eventId: string, token: string | null | undefined) {
    if (!eventId || !token) return;
    await Event.updateOne(
        { _id: eventId, "sumupOperationClaim.token": token },
        { $unset: { sumupOperationClaim: 1 } }
    );
}

export async function refreshSumUpEventOperation(eventId: string, token: string) {
    if (!eventId || !token) return false;
    const result = await Event.updateOne(
        { _id: eventId, "sumupOperationClaim.token": token },
        { $set: { "sumupOperationClaim.expiresAt": new Date(Date.now() + SUMUP_EVENT_OPERATION_LEASE_MS) } }
    );
    return (result.matchedCount ?? result.modifiedCount) === 1;
}

export function startSumUpEventOperationHeartbeat(eventId: string, token: string) {
    const timer = setInterval(() => {
        void refreshSumUpEventOperation(eventId, token).catch((error) => {
            console.error("SumUp event operation heartbeat error:", error);
        });
    }, SUMUP_EVENT_OPERATION_HEARTBEAT_MS);
    timer.unref?.();
    return () => clearInterval(timer);
}
