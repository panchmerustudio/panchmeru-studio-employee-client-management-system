export function notificationHref(relatedEntityType: string | null, relatedEntityId: string | null): string | null {
  if (!relatedEntityType || !relatedEntityId) return null;
  switch (relatedEntityType) {
    case "task":
      return `/tasks/${relatedEntityId}`;
    case "leave_request":
      return "/leave";
    case "site":
      return `/sites/${relatedEntityId}`;
    case "material_request":
      return "/materials";
    case "chat_conversation":
      return `/chat/${relatedEntityId}`;
    case "storage":
      return "/settings/storage";
    default:
      return null;
  }
}
