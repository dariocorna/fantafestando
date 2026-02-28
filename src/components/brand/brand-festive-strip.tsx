import { cn } from "@/lib/utils";

interface BrandFestiveStripProps {
    compact?: boolean;
    decorative?: boolean;
    className?: string;
    "data-testid"?: string;
}

export function BrandFestiveStrip({
    compact = false,
    decorative = true,
    className,
    "data-testid": dataTestId,
}: BrandFestiveStripProps) {
    if (!decorative) return null;

    return (
        <div className={cn("pointer-events-none select-none", className)} aria-hidden data-testid={dataTestId}>
            <svg
                viewBox="0 0 640 72"
                className={cn("w-full", compact ? "h-10" : "h-14")}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path d="M8 14C98 44 192 44 282 14C372 -16 466 -16 632 14" stroke="#9CB9E7" strokeWidth="2.5" strokeLinecap="round" />
                {[24, 78, 132, 186, 240, 294, 348, 402, 456, 510, 564, 618].map((x, index) => {
                    const colors = ["#169DEF", "#FDCD18", "#8BBF2F", "#E76528", "#1556B1"];
                    const color = colors[index % colors.length];
                    return <path key={x} d={`M${x} 16L${x + 10} 38L${x + 20} 16H${x}Z`} fill={color} />;
                })}
                <path d="M40 58C118 70 197 70 275 58C353 46 432 46 600 58" stroke="#169DEF" strokeWidth="9" strokeLinecap="round" opacity="0.35" />
                <path d="M40 62C118 74 197 74 275 62C353 50 432 50 600 62" stroke="#FDCD18" strokeWidth="6" strokeLinecap="round" opacity="0.8" />
            </svg>
        </div>
    );
}

