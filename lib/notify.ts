// Sending resident SMS. Each unit's link is the same every month (see residents.ts).
import type { Db } from "./db";
import type { SmsSender } from "./sms";
import { smsText } from "./sms";
import { jalaliMonthName } from "./date";
import { rialToTomanLabel } from "./money";
import { currentToken, residentUrl } from "./residents";

/** Texts every active unit with a phone and a charge in this period. Returns how many were sent. */
export async function sendChargeNotices(sql: Db, sms: SmsSender, periodId: string): Promise<number> {
  const rows = await sql<{ unitId: string; phone: string; amountRial: bigint; jalaliMonth: number }[]>`
    SELECT u.id AS unit_id, u.phone, e.amount_rial, cp.jalali_month
    FROM ledger_entries e
    JOIN units u ON u.id = e.unit_id
    JOIN charge_periods cp ON cp.id = e.period_id
    WHERE e.period_id = ${periodId} AND e.kind = 'charge_issued'
      AND u.is_active AND u.phone IS NOT NULL
    ORDER BY u.sort_key`;

  let sent = 0;
  for (const r of rows) {
    const link = residentUrl(await currentToken(sql, r.unitId));
    const res = await sms.send(r.phone, smsText.chargeIssued(jalaliMonthName(r.jalaliMonth), rialToTomanLabel(r.amountRial), link));
    if (res.ok) sent++;
  }
  return sent;
}
