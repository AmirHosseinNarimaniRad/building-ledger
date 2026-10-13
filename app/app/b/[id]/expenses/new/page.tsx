import { requireBuilding } from "@/lib/auth/session";
import { jalaliInputValue, todayTehran } from "@/lib/date";
import { PageTitle } from "@/components/ui";
import { ExpenseForm } from "./expense-form";

export default async function NewExpensePage({ params }: PageProps<"/app/b/[id]/expenses/new">) {
  const { id } = await params;
  await requireBuilding(id);
  return (
    <>
      <PageTitle>ثبت هزینه</PageTitle>
      <ExpenseForm buildingId={id} today={jalaliInputValue(todayTehran())} />
    </>
  );
}
