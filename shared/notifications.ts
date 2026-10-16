export const notificationEvents = [
  'assignment',
  'comment',
  'mention',
  'status',
  'watcher',
  'move',
] as const;
export type NotificationEvent = (typeof notificationEvents)[number];
export interface NotificationPreference {
  event: NotificationEvent;
  in_app: boolean;
  email: boolean;
}
