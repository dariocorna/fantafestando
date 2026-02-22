import dbConnect from "./mongoose";
import Event from "@/models/Event";

export async function getActiveEvent() {
    await dbConnect();
    const event = await Event.findOne({ active: true }).lean();
    return event;
}

export async function getActiveEventId() {
    const event = await getActiveEvent();
    return event ? (event._id as any).toString() : null;
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
        return adminFestaId.value;
    }
    return await getActiveEventId();
}

export async function getAdminContextEvent() {
    await dbConnect();
    const eventId = await getAdminContextEventId();
    if (!eventId) return null;
    return await Event.findById(eventId).lean();
}
