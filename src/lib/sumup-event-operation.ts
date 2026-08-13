import { randomUUID } from "node:crypto";
import Event from "@/models/Event";

const SUMUP_EVENT_OPERATION_LEASE_MS = 5 * 60 * 1000;

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
