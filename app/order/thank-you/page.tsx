import Link from "next/link";

import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function ThankYouPage() {
  const dict = getDictionary(await getServerLocale());
  const t = dict.thankYou;

  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="text-2xl font-bold text-text">{t.title}</h1>
      <p className="mt-4 text-muted">{t.message}</p>
      <Link href="/" className="btn btn-primary mt-8 inline-flex">
        {t.backHome}
      </Link>
    </div>
  );
}
