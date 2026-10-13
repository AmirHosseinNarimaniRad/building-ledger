import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { currentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "ورود — دفتر شفاف ساختمان" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/app");
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-title font-bold">دفتر شفاف ساختمان</h1>
        <p className="mb-6 text-label text-ink/70">ورود مدیر ساختمان</p>
        <LoginForm />
      </Card>
    </main>
  );
}
