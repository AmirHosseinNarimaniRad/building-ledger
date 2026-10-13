import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted; never load fonts from an external CDN.
const vazirmatn = localFont({
  src: "./fonts/Vazirmatn-Variable.woff2",
  variable: "--font-vazirmatn",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "دفتر شفاف ساختمان",
  description: "دفتر مالی شفاف برای ساختمان‌های مسکونی",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
