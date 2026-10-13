import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { displayMobile } from "@/lib/phone";
import { logout } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-ink/10 print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/app" className="font-bold">
            دفتر شفاف ساختمان
          </Link>
          <form action={logout} className="flex items-center gap-3 text-small text-ink/70">
            <span dir="ltr">{displayMobile(user.phone)}</span>
            <button type="submit" className="underline hover:text-ink">
              خروج
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 print:max-w-none print:p-0">{children}</div>
    </div>
  );
}
