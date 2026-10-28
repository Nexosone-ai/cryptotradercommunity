import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { getI18n } from "@/lib/i18n-server";
import { AdminConsole } from "./AdminConsole";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Admin", "관리자"), robots: { index: false } };
}
export const dynamic = "force-dynamic";

/**
 * Not linked from the menu. Non-admins get a 404 here and 401/403 from every
 * /api/admin route — hiding the link is not the access control.
 */
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("ADMIN")) notFound();
  return <AdminConsole adminId={user.id} />;
}
