import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { listBuildings } from "@/lib/buildings";
import { requireUser } from "@/lib/auth/session";
import { buttonStyles, Card, PageTitle } from "@/components/ui";

export default async function BuildingsPage() {
  const user = await requireUser();
  const buildings = await listBuildings(db(), user.id);
  if (buildings.length === 0) redirect("/app/b/new");
  if (buildings.length === 1) redirect(`/app/b/${buildings[0].id}`);

  return (
    <>
      <PageTitle
        action={
          <Link href="/app/b/new" className={buttonStyles.secondary}>
            ساختمان جدید
          </Link>
        }
      >
        ساختمان‌های شما
      </PageTitle>
      <div className="flex flex-col gap-3">
        {buildings.map((b) => (
          <Link key={b.id} href={`/app/b/${b.id}`}>
            <Card className="hover:border-primary">
              <div className="font-semibold">{b.name}</div>
              {b.address && <div className="text-small text-ink/60">{b.address}</div>}
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
