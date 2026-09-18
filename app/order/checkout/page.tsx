import { CheckoutClient } from "@/components/CheckoutClient";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function CheckoutPage() {
  const dict = getDictionary(await getServerLocale());
  return <CheckoutClient dict={dict} />;
}
