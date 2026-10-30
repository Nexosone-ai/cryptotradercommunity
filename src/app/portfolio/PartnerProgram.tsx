import { Card } from "@/components/ui";

const SPLIT = [
  { key: "owner", who: "Bot or copy-trading operator", pct: "70%", how: "Fee × 0.70" },
  { key: "pool", who: "Admin allocation pool", pct: "30%", how: "Fee × 0.30" },
  { key: "platform", who: "└ Platform", pct: "9%", how: "Pool 30% × 30%" },
  { key: "partners", who: "└ Partners (wholesale partner + affiliate)", pct: "21%", how: "Pool 30% × 70%" },
] as const;

/** How partner earnings work. Shown only in the Partner section of My page (signed-in users). */
export async function PartnerProgram() {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-semibold">Revenue split (as a share of 100% of confirmed additional Builder Fee)</h2>
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-line">
            {SPLIT.map(({ key, who, pct, how }) => (
              <tr key={key}>
                <td className="py-2">{who}</td>
                <td className="num py-2 text-right font-semibold text-accent">{pct}</td>
                <td className="py-2 pl-4 text-right text-xs text-muted">{how}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          Example: 100 USDC of confirmed Builder Fee from an affiliate&apos;s client, with the wholesale partner&apos;s portion set to 10% → operator 70 ·
          platform 9 · wholesale partner 10 · affiliate 11 USDC. Policy changes are recorded as versions and never apply retroactively to past
          settlements.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Wholesale partners and affiliates</h3>
          <p className="mt-2 text-sm text-muted">
            The admin appoints wholesale partners. A wholesale partner sets their portion of the 21% and recruits affiliates with an invite link;
            affiliates refer clients but can&apos;t recruit. On an affiliate&apos;s client, the wholesale partner keeps their portion and the affiliate
            gets the rest. On the wholesale partner&apos;s own client, they get all 21%.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">No referrer, or referrer not eligible</h3>
          <p className="mt-2 text-sm text-muted">
            If a client has no partner, the whole 30% goes to the platform. If a partner is suspended, their share goes to the platform too.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">Locked relationships and fraud prevention</h3>
          <p className="mt-2 text-sm text-muted">
            A referral relationship is recorded when the wallet first signs up and cannot be changed afterwards. Self-referrals are blocked
            automatically, and multi-account abuse is sanctioned after admin review.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold">When earnings settle</h3>
          <p className="mt-2 text-sm text-muted">
            Only fills whose Builder revenue is confirmed on Hyperliquid are recorded in the ledger. Payouts go out after admin approval; automatic
            payouts will be introduced once verified.
          </p>
        </Card>
      </div>

      <p className="text-xs text-faint">
        This program is the platform&apos;s internal partner ledger and is separate from Hyperliquid&apos;s own referral program. Partners are
        responsible for complying with referral-reward and advertising laws in their jurisdiction.
      </p>
    </div>
  );
}
