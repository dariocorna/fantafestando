"use server"

import { PrinterService } from "@/lib/printer";
import { revalidatePath } from "next/cache";

export async function reprintOrder(formData: FormData) {
    const orderId = formData.get("orderId") as string;
    if (!orderId) return;

    await PrinterService.routeOrderToPrinters(orderId);
    revalidatePath("/admin/orders");
}
