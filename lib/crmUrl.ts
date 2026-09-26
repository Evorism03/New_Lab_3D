// Where the CRM (lab) lives, for the "switch to CRM" link in the admin panel.
// CRM_URL wins; otherwise it is guessed the way setup names it: crm.<site domain>
// (or localhost:3001 in development / when the site is opened by IP).
export function getCrmUrl(): string {
  if (process.env.CRM_URL) return process.env.CRM_URL.replace(/\/$/, "");
  const app = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const url = new URL(app);
    const isLocal = url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname);
    if (isLocal) return `${url.protocol}//${url.hostname}:3001`;
    return `${url.protocol}//crm.${url.hostname.replace(/^www\./, "")}`;
  } catch {
    return "http://localhost:3001";
  }
}
