"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ensureAdminSession } from "@/lib/authz";

export async function setAdminEventContext(eventId: string) {
    const sessionCheck = await ensureAdminSession();
    if (!sessionCheck.ok) {
        return { error: sessionCheck.error };
    }

    const cookieStore = await cookies();
    cookieStore.set("admin_festa_id", eventId, { path: "/", maxAge: 60 * 60 * 24 * 30 }); // 30 days
    revalidatePath("/admin", "layout");

    return { success: true };
}
