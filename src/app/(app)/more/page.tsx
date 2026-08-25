import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { secondaryNavFor } from "@/lib/nav";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icon";

export default async function MorePage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const items = secondaryNavFor(user.roleKey);

  return (
    <div>
      <PageHeader title="More" />
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="card flex flex-col items-center gap-2 p-5 text-center hover:bg-background">
            <Icon name={item.icon} className="h-6 w-6 text-brand-ink" />
            <span className="text-sm font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
