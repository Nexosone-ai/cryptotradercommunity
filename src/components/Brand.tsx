import Image from "next/image";
import { cx } from "./ui";

/**
 * The cryptotradercommunity.org logo. The mark sits on a white tile because its
 * navy arc disappears on the dark theme; the wordmark keeps the logo's green
 * "trader" with light text in place of navy.
 */
export function BrandMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-lg bg-white", className)} style={{ width: size, height: size, padding: size * 0.08 }}>
      <Image src="/brand/logo-mark.png" alt="" width={size} height={size} priority className="h-full w-full" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-bold tracking-tight", className)}>
      crypto<span className="text-[#01af8b]">trader</span>community<span className="font-semibold text-muted">.org</span>
    </span>
  );
}
