# Connecting an SMS panel

The app sends three kinds of SMS. All of them go out as **templates approved in the panel**
(Kavenegar "lookup", SMS.ir "verify"). Templates are sent on the provider's service lines: they
arrive fast, reach numbers that block advertising SMS, and need no dedicated line. The app sends
only the values; the panel holds the text.

Supported panels: **Kavenegar** and **SMS.ir**. You need one, not both.

## 1. Open an account

Sign up, verify your identity, and add a little credit. Template approval usually takes one to a
few working days, so start this early.

## 2. Submit the three templates

Copy each text **exactly**, including the line break. The app's own copy of these texts
(`lib/sms/shared.ts`, `renderSms`) must stay word for word the same; the tests check that each
fits two Persian SMS parts (134 characters) with a full resident link.

### Kavenegar

In the panel: *Lookup / Verify templates → new template*. Pick the names below (any names work;
they go in `.env`).

| Template name | Text |
| --- | --- |
| `ledger-otp` | `کد ورود شما: %token`<br>`دفتر شفاف ساختمان` |
| `ledger-charge` | `شارژ %token ساختمان شما: %token2 تومان`<br>`جزئیات: %token3` |
| `ledger-reminder` | `یادآوری بدهی شارژ ساختمان: %token تومان`<br>`جزئیات: %token2` |

What the app puts in each token:

| Template | `%token` | `%token2` | `%token3` |
| --- | --- | --- | --- |
| `ledger-otp` | 6-digit code | | |
| `ledger-charge` | month name, e.g. `مهر` | amount in toman, e.g. `۱٬۲۵۰٬۰۰۰` | resident link |
| `ledger-reminder` | amount owed in toman | resident link | |

### SMS.ir

In the panel: *Developers → Verify templates → new template*. The panel gives each approved
template a number; those numbers go in `.env`.

| Template | Text |
| --- | --- |
| Login code | `کد ورود شما: #CODE#`<br>`دفتر شفاف ساختمان` |
| New charge | `شارژ #MONTH# ساختمان شما: #AMOUNT# تومان`<br>`جزئیات: #LINK#` |
| Payment reminder | `یادآوری بدهی شارژ ساختمان: #AMOUNT# تومان`<br>`جزئیات: #LINK#` |

### Notes for approval

- The resident link looks like `https://<your-domain>/r/AbCdEfGhIjKlMnOpQrStUv`: the domain plus
  about 26 characters. If the panel asks what the link parameter holds, that is the answer. Some
  panels want to know the link's domain before approving templates with links; register the
  domain first.
- The values never contain spaces (Kavenegar's tokens do not allow them).
- If a panel asks for changes to the wording, change `renderSms` in `lib/sms/shared.ts` to match
  the approved text, and run `npm test`.

## 3. Configure the server

In `deploy/.env` (or `.env.local` for development):

```sh
SMS_SENDER=kavenegar
KAVENEGAR_API_KEY=...            # panel → account settings → API key
KAVENEGAR_TEMPLATE_OTP=ledger-otp
KAVENEGAR_TEMPLATE_CHARGE=ledger-charge
KAVENEGAR_TEMPLATE_REMINDER=ledger-reminder
```

or

```sh
SMS_SENDER=smsir
SMSIR_API_KEY=...                # panel → developers → API keys
SMSIR_TEMPLATE_OTP=123456        # the ids the panel gave the approved templates
SMSIR_TEMPLATE_CHARGE=123457
SMSIR_TEMPLATE_REMINDER=123458
```

Then restart the app:

```sh
docker compose -f docker-compose.prod.yml --env-file .env up -d app
```

A missing or malformed setting makes the app refuse every request, so the container shows as
unhealthy and the log names the setting (`docker compose … logs app`). A typo is caught at
deploy time, not at a manager's first login.

## 4. Send a test to your own phone

```sh
docker compose -f docker-compose.prod.yml --env-file .env exec app node sms-test.cjs 09121234567
```

It sends one SMS of each template with sample values and prints the panel's answer:

```
SMS_SENDER=kavenegar, to +989121234567
sent   otp (37/134 chars), id 8792343
sent   chargeIssued (92/134 chars), id 8792344
sent   arrearsReminder (97/134 chars), id 8792345
```

Check that the three texts on the phone read exactly as above. The link in the test opens the
"invalid link" page; that is expected. In development, the same test is
`npm run sms:test -- 09121234567`.

## When sending fails

- **Login:** the manager sees «ارسال پیامک ممکن نشد» and can try again at once. The unsent code is
  voided. Failed attempts still count toward the limit of 5 codes an hour.
- **Charges and reminders:** the charge is issued either way. The page says how many SMS did not
  go out, and the manager can copy a unit's link from the units page. After 3 failures in a row a
  batch stops, rather than trying every unit against a panel that is down or out of credit.
- **The log** (`docker compose … logs app | grep sms`) shows the panel's answer, e.g.
  `[sms] kavenegar failed to send otp: 418 اعتبار شما کافی نمی‌باشد` (out of credit). It never
  shows phone numbers, message texts or the API key.

Common Kavenegar answers: `403` wrong API key · `411` invalid recipient · `418` out of credit ·
`424` template not found or not approved. For SMS.ir, the panel's message is logged as it comes.
