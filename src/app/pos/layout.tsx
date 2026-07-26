import type { ReactNode } from "react";
import { requirePosPageAccess } from "@/lib/pos-access";

export default async function PosLayout({ children }: { children: ReactNode }) {
  await requirePosPageAccess();
  return children;
}
