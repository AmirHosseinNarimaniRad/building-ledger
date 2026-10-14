import type { Db } from "./db";
import { SMS_MAX_FAILURES_IN_A_ROW, type SmsSender } from "./sms";
import { rialToTomanDigits } from "./money";
import { currentToken, residentUrl } from "./residents";

/** At most one reminder per unit in this window. */
export const REMINDER_GAP_HOURS = 24;

export interface ArrearsRow {
  unitId: string;
  label: string;
  residentName: string | null;
  phone: string | null;
  debtRial: bigint;
  lastReminderAt: Date | null;
  /** Can be texted now: has a phone and was not reminded in the last 24 hours. */
  remindable: boolean;
}

export async function listArrears(sql: Db, buildingId: string): Promise<ArrearsRow[]> {
  return sql<ArrearsRow[]>`
    SELECT u.id AS unit_id, u.label, u.resident_name, u.phone, d.debt_rial,
      r.last AS last_reminder_at,
      (u.phone IS NOT NULL AND (r.last IS NULL OR r.last < now() - ${`${REMINDER_GAP_HOURS} hours`}::interval)) AS remindable
    FROM unit_debts d
    JOIN units u ON u.id = d.unit_id
    LEFT JOIN LATERAL (SELECT max(sent_at) AS last FROM arrears_reminders WHERE unit_id = u.id) r ON true
    WHERE d.building_id = ${buildingId} AND d.debt_rial > 0
    ORDER BY d.debt_rial DESC, u.sort_key`;
}

/**
 * Texts each remindable unit its current debt and link. unitIds = null means every unit that owes.
 * skipped: no phone, or reminded in the last 24 hours. failed: the SMS panel refused or was down.
 */
export async function sendReminders(
  sql: Db,
  sms: SmsSender,
  args: { buildingId: string; unitIds: string[] | null; by: string },
): Promise<{ sent: number; skipped: number; failed: number }> {
  const rows = (await listArrears(sql, args.buildingId)).filter(
    (r) => args.unitIds === null || args.unitIds.includes(r.unitId),
  );
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let failedInARow = 0;
  for (const r of rows) {
    if (!r.remindable || !r.phone) {
      skipped++;
      continue;
    }
    if (failedInARow >= SMS_MAX_FAILURES_IN_A_ROW) {
      failed++; // the panel is down or out of credit: stop trying
      continue;
    }
    const link = residentUrl(await currentToken(sql, r.unitId));
    const res = await sms.send(r.phone, { kind: "arrearsReminder", amount: rialToTomanDigits(r.debtRial), link });
    if (!res.ok) {
      failed++;
      failedInARow++;
      continue;
    }
    failedInARow = 0;
    await sql`INSERT INTO arrears_reminders (unit_id, amount_rial, sent_by) VALUES (${r.unitId}, ${r.debtRial}, ${args.by})`;
    sent++;
  }
  return { sent, skipped, failed };
}
