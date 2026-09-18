import { ShowcaseAdmin } from "@/components/ShowcaseAdmin";
import { prisma } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function AdminShowcasePage() {
  const dict = getDictionary(await getServerLocale());
  const t = dict.admin;

  const items = await prisma.showcaseItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">{t.showcaseTitle}</h1>
      <p className="mt-1 text-sm text-muted">{t.showcaseHint}</p>
      <div className="mt-6">
        <ShowcaseAdmin items={items} dict={dict} />
      </div>
    </div>
  );
}
