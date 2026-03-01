import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandVariant = "menu" | "admin" | "pos";

interface BrandLogoLockupProps {
    title: string;
    subtitle?: string;
    compact?: boolean;
    variant?: BrandVariant;
    className?: string;
    "data-testid"?: string;
}

const variantStyles: Record<BrandVariant, { title: string; subtitle: string; badge: string }> = {
    menu: {
        title: "text-[var(--brand-blue-700)]",
        subtitle: "text-[var(--brand-blue-500)]",
        badge: "bg-[var(--brand-yellow-500)]/20 text-[var(--brand-blue-700)]",
    },
    admin: {
        title: "text-[var(--brand-ink)]",
        subtitle: "text-[var(--brand-blue-700)]",
        badge: "bg-[var(--brand-blue-500)]/12 text-[var(--brand-blue-700)]",
    },
    pos: {
        title: "text-[var(--brand-ink)]",
        subtitle: "text-[var(--brand-blue-700)]",
        badge: "bg-[var(--brand-yellow-500)]/18 text-[var(--brand-ink)]",
    },
};

export function BrandLogoLockup({
    title,
    subtitle = "Festa",
    compact = false,
    variant = "menu",
    className,
    "data-testid": dataTestId,
}: BrandLogoLockupProps) {
    const styles = variantStyles[variant];

    return (
        <div className={cn("flex min-w-0 items-center gap-3", className)} data-testid={dataTestId}>
            <Image
                src="/icons/icon-96x96.png"
                alt="Logo Festa"
                width={compact ? 44 : 58}
                height={compact ? 44 : 58}
                className={cn(
                    "rounded-2xl border border-white/70 bg-white p-1 shadow-sm",
                    compact ? "h-11 w-11" : "h-14 w-14"
                )}
                priority
            />
            <div className="min-w-0">
                <div className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.15em]", styles.badge)}>
                    OSG Fest
                </div>
                <p className={cn("font-brand-display mt-1 truncate font-extrabold tracking-tight", compact ? "text-lg" : "text-xl md:text-2xl", styles.title)}>
                    {title}
                </p>
                <p className={cn("truncate text-xs font-semibold md:text-sm", styles.subtitle)}>
                    <span className="font-brand-script mr-1 text-base leading-none text-[var(--brand-yellow-500)]">in</span>
                    {subtitle}
                </p>
            </div>
        </div>
    );
}

