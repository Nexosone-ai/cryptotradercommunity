import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { I18nProvider } from "@/components/I18nProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { WalletProvider, type Me } from "@/components/wallet/WalletProvider";
import { getCurrentUser } from "@/lib/auth/current";
import { getPublicConfig } from "@/lib/config";
import { getI18n } from "@/lib/i18n-server";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: "CryptoTraderCommunity", template: "%s · CryptoTraderCommunity" },
    description: t(
      "An open community where anyone can list trading bots, publish verified live performance and trade on Hyperliquid liquidity.",
      "누구나 트레이딩 봇을 등록하고, 검증된 거래 성과를 공개하며, Hyperliquid 유동성으로 거래하는 오픈 커뮤니티.",
    ),
  };
}

export const viewport: Viewport = { themeColor: "#08090b", width: "device-width", initialScale: 1 };

async function loadMe(): Promise<Me> {
  const config = getPublicConfig();
  try {
    const user = await getCurrentUser();
    return { user: user ? { id: user.id, walletAddress: user.walletAddress, roles: user.roles } : null, config };
  } catch {
    // Database unavailable: the site still renders read-only pages.
    return { user: null, config };
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const me = await loadMe();
  const { locale, t } = await getI18n();
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <I18nProvider locale={locale}>
        <WalletProvider initialMe={me}>
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">{children}</main>
          <footer className="border-t border-line px-4 py-8 text-xs leading-relaxed text-faint">
            <div className="mx-auto max-w-7xl space-y-2">
              <p>
                {t(
                  "CryptoTraderCommunity is non-custodial software. Your funds stay in your own Hyperliquid account and orders are filled on the Hyperliquid order book. Leveraged trading can lose your entire principal and positions can be liquidated. Past performance does not guarantee future returns.",
                  "CryptoTraderCommunity는 비수탁형 소프트웨어입니다. 자금은 사용자 본인의 Hyperliquid 계정에 남아 있으며, 주문은 Hyperliquid 오더북에서 체결됩니다. 레버리지 거래는 원금 전액 손실과 강제청산 위험이 있으며 과거 성과는 미래 수익을 보장하지 않습니다.",
                )}
              </p>
              <p className="flex flex-wrap gap-4">
                <Link href="/guide">{t("User guide", "이용 가이드")}</Link>
                <Link href="/docs">{t("Service, fees & security", "서비스·수수료·보안 문서")}</Link>
                <Link href="/docs#risk">{t("Risk disclosure", "위험 고지")}</Link>
                <Link href="/docs#terms">{t("Terms of use", "이용약관")}</Link>
                <span>© CryptoTraderCommunity</span>
              </p>
            </div>
          </footer>
        </WalletProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
