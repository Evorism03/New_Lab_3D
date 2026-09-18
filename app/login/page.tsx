import { LoginClient } from "@/components/LoginClient";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/translations";

export default async function LoginPage() {
  const dict = getDictionary(await getServerLocale());
  return <LoginClient dict={dict} />;
}
