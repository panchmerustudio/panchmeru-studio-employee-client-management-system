import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { NewEmployeeForm } from "./form";

export default async function NewEmployeePage() {
  const user = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE).catch(() => null);
  if (!user) redirect("/employees");
  return <NewEmployeeForm />;
}
