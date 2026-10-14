// Sending resident SMS. Each unit's link is the same every month (see residents.ts).
import type { Db } from "./db";
import { SMS_MAX_FAILURES_IN_A_ROW, type SmsSender } from "./sms";
import { jalaliMonthName } from "./date";
import { rialToTomanDigits } from "./money";
import { currentToken, residentUrl } from "./residents";

/** Texts every active unit with a phone and a charge in this period. */
export async function sendChargeNotices(sql: Db, sms: SmsSender, periodId: string): Promise<{ sent: number; failed: number }> {
  const rows = await sql<{ unitId: string; phone: string; amountRial: bigint; jalaliMonth: number }[]>`
    SELECT u.id AS unit_id, u.phone, e.amount_rial, cp.jalali_month
    FROM ledger_entries e
    JOIN units u ON u.id = e.unit_id
    JOIN charge_periods cp ON cp.id = e.period_id
    WHERE e.period_id = ${periodId} AND e.kind = 'charge_issued'
      AND u.is_active AND u.phone IS NOT NULL
    ORDER BY u.sort_key`;

  let sent = 0;
  let failedInARow = 0;
  for (const r of rows) {
    if (failedInARow >= SMS_MAX_FAILURES_IN_A_ROW) break;
    const link = residentUrl(await currentToken(sql, r.unitId));
    const res = await sms.send(r.phone, {
      kind: "chargeIssued",
      month: jalaliMonthName(r.jalaliMonth),
      amount: rialToTomanDigits(r.amountRial),
      link,
    });
    failedInARow = res.ok ? 0 : failedInARow + 1;
    if (res.ok) sent++;
  }
  return { sent, failed: rows.length - sent };
}
