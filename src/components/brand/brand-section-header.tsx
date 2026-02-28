import { cn } from "@/lib/utils";

interface BrandSectionHeaderProps {
    title: string;
    subtitle?: string;
    className?: string;
    "data-testid"?: string;
}

export function BrandSectionHeader({
    title,
    subtitle,
    className,
    "data-testid": dataTestId,
}: BrandSectionHeaderProps) {
    return (
        <div className={cn("space-y-1", className)} data-testid={dataTestId}>
            <div className="inline-flex items-center gap-2">
                <span className="h-7 w-1.5 rounded-full bg-[var(--brand-yellow-500)]" />
                <h2 className="font-brand-display text-xl font-extrabold uppercase tracking-wide text-[var(--brand-ink)] md:text-2xl">
                    {title}
                </h2>
            </div>
            {subtitle ? (
                <p className="pl-4 text-sm font-semibold text-[var(--brand-blue-700)]/90">
                    {subtitle}
                </p>
            ) : null}
        </div>
    );
}

