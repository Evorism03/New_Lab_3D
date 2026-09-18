import { UploadClient } from "@/components/UploadClient";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function UploadPage() {
  const dict = getDictionary(await getServerLocale());
  return <UploadClient dict={dict} />;
}
