import { Card } from "@/components/ui";

export const metadata = { title: "اتصال برقرار نیست — دفتر شفاف ساختمان" };

export default function OfflinePage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="max-w-sm text-center">
        <h1 className="mb-2 text-title font-bold">اتصال به اینترنت برقرار نیست</h1>
        <p className="text-label text-ink/70">
          دفتر ساختمان فقط با اینترنت باز می‌شود تا همیشه آخرین اطلاعات را ببینید. بعد از برقراری اتصال دوباره امتحان کنید.
        </p>
      </Card>
    </main>
  );
}
