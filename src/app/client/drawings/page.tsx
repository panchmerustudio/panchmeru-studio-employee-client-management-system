import { redirect } from "next/navigation";
import { getCurrentClient } from "@/lib/client-auth";
import { getClientDrawings } from "@/lib/client-portal";
import { PageHeader } from "@/components/ui";
import { LogoutButton } from "../logout-button";
import { ClientNav } from "../client-nav";
import { DrawingLibrary } from "./drawing-library";

export default async function ClientDrawingsPage() {
  const client = await getCurrentClient();
  if (!client) redirect("/client/login");

  const drawings = await getClientDrawings(client.clientId);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <PageHeader title="Drawings" subtitle={client.clientName} action={<LogoutButton />} />
      <DrawingLibrary drawings={drawings} />
      <ClientNav active="/client/drawings" />
    </div>
  );
}
