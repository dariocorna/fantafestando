"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setAdminEventContext(eventId: string) {
    const cookieStore = await cookies();
    cookieStore.set("admin_festa_id", eventId, { path: "/", maxAge: 60 * 60 * 24 * 30 }); // 30 days
    revalidatePath("/admin", "layout");
}
