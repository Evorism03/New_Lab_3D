import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getCrmUrl } from "@/lib/crmUrl";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin/showcase");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/");
  }

  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <nav className="mb-8 flex flex-wrap items-center gap-4 border-b border-border pb-4 text-sm">
        <Link href="/admin/showcase" className="text-muted transition-colors hover:text-accent">
          {t.showcaseTitle}
        </Link>
        <Link href="/admin/materials" className="text-muted transition-colors hover:text-accent">
          {t.materialImagesTitle}
        </Link>
        <Link href="/admin/pricing" className="text-muted transition-colors hover:text-accent">
          {t.pricingTitle}
        </Link>
        <a
          href={getCrmUrl()}
          className="ml-auto rounded-lg border border-border px-3 py-1 text-text transition-colors hover:border-accent hover:text-accent"
        >
          {t.crmLink}
        </a>
      </nav>
      {children}
    </div>
  );
}
