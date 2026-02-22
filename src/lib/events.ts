import dbConnect from "./mongoose";
import Event from "@/models/Event";

export async function getActiveEvent() {
    await dbConnect();
    const event = await Event.findOne({ active: true, archived: { $ne: true } }).lean();
    return event;
}

export async function getActiveEventId() {
    const event = await getActiveEvent();
    return event ? String(event._id) : null;
}

export async function getAllEvents() {
    await dbConnect();
    const events = await Event.find().sort({ createdAt: -1 }).lean();
    return events;
}

export async function getAdminContextEventId() {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const adminFestaId = cookieStore.get("admin_festa_id");
    if (adminFestaId && adminFestaId.value) {
        await dbConnect();
        const selected = await Event.findOne({
            _id: adminFestaId.value,
            archived: { $ne: true }
        }).select("_id").lean();
        if (selected) return adminFestaId.value;
    }
    return await getActiveEventId();
}

export async function getAdminContextEvent() {
    await dbConnect();
    const eventId = await getAdminContextEventId();
    if (!eventId) return null;
    return await Event.findOne({ _id: eventId, archived: { $ne: true } }).lean();
}
