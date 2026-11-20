export const ROLES = ["attendee", "organizer", "security", "admin"] as const;

export type Role = (typeof ROLES)[number];
