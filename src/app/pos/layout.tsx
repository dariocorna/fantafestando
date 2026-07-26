import type { ReactNode } from "react";
import { requirePosPageAccess } from "@/lib/pos-access";

export const dynamic = "force-dynamic";

export default async function PosLayout({ children }: { children: ReactNode }) {
  await requirePosPageAccess();
  return children;
}
