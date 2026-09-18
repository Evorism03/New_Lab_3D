import { TrackOrderClient } from "@/components/TrackOrderClient";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function TrackOrderPage() {
  const dict = getDictionary(await getServerLocale());
  return <TrackOrderClient dict={dict} />;
}
