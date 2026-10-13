import Link from "next/link";
import { requireBuilding } from "@/lib/auth/session";

const NAV = [
  { href: "", label: "داشبورد" },
  { href: "/ledger", label: "دفتر" },
  { href: "/charges", label: "شارژها" },
  { href: "/arrears", label: "معوقات" },
  { href: "/units", label: "واحدها" },
  { href: "/report", label: "گزارش" },
];

export default async function BuildingLayout({ children, params }: LayoutProps<"/app/b/[id]">) {
  const { id } = await params;
  const { building } = await requireBuilding(id);
  return (
    <>
      <div className="mb-5 print:hidden">
        <div className="text-small text-ink/60">{building.address}</div>
        <div className="text-title font-bold">{building.name}</div>
        <nav className="mt-3 flex flex-wrap gap-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={`/app/b/${id}${n.href}`}
              className="whitespace-nowrap rounded-full bg-neutral px-3 py-1 text-label hover:bg-primary hover:text-background"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </>
  );
}
