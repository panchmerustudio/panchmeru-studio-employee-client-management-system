"use server";

import { revalidatePath } from "next/cache";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export async function markAllRead() {
  const user = await requireUser();
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt)));
  revalidatePath("/notifications");
}

export async function markRead(id: string) {
  const user = await requireUser();
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.recipientId, user.id)));
  revalidatePath("/notifications");
}
