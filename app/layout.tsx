import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "TheeDeck — รวมระบบของธีรวัฒน์",
    description: "TheeDeck · ศูนย์บัญชาการส่วนตัวของธีรวัฒน์ (ตารางเรียน, งาน, เทรด, ฝึกฟัง)",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>
        <a href="#main" className="skip-link">ข้ามไปเนื้อหา</a>
        <Nav />
        {children}
      </body>
    </html>
  );
}