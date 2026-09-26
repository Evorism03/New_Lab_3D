import { PrintersAdmin } from "@/components/PrintersAdmin";
import { getBambuddyPublicUrl } from "@/lib/bambuddy";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function AdminPrintersPage() {
  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">{t.printersTitle}</h1>
          <p className="mt-1 text-sm text-muted">{t.printersHint}</p>
        </div>
        <a
          href={getBambuddyPublicUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border px-3 py-1 text-sm text-text transition-colors hover:border-accent hover:text-accent"
        >
          {t.bambuddyLink}
        </a>
      </div>
      <div className="mt-6">
        <PrintersAdmin dict={dict} />
      </div>
    </div>
  );
}
