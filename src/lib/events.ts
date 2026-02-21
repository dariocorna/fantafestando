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
