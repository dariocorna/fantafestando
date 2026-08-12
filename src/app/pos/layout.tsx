import type { ReactNode } from "react";
import { requirePosPageAccess } from "@/lib/pos-access";
import { ensurePrintQueueSchedulerStarted } from "@/lib/print-queue-scheduler";

export const dynamic = "force-dynamic";

export default async function PosLayout({ children }: { children: ReactNode }) {
  await requirePosPageAccess();
  ensurePrintQueueSchedulerStarted();
  return children;
}
