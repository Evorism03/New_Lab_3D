import Image from "next/image";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BRAND_NAME } from "@/lib/brand";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export async function Header() {
  const locale = await getServerLocale();
  const dict = getDictionary(locale);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-[rgba(10,10,10,0.7)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap text-base font-bold tracking-tight text-text sm:text-lg"
        >
          <Image src="/logo.svg" alt="" width={28} height={24} className="h-5 w-auto sm:h-6" />
          {BRAND_NAME}
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <Link href="/order/upload" className="whitespace-nowrap transition-colors hover:text-accent">
            {dict.header.getQuote}
          </Link>
          <Link href="/admin/orders" className="whitespace-nowrap transition-colors hover:text-accent">
            {dict.header.admin}
          </Link>
          <LanguageSwitcher locale={locale} />
        </nav>
      </div>
    </header>
  );
}
