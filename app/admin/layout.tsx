import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin/orders");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/");
  }

  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <nav className="mb-8 flex gap-4 border-b border-border pb-4 text-sm">
        <Link href="/admin/orders" className="text-muted transition-colors hover:text-accent">
          {t.ordersTitle}
        </Link>
        <Link href="/admin/showcase" className="text-muted transition-colors hover:text-accent">
          {t.showcaseTitle}
        </Link>
      </nav>
      {children}
    </div>
  );
}
