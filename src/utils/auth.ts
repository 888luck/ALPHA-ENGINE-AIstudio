/**
 * Shared Institutional Authentication Utilities
 * Ensures consistent session auth header injection across all dashboard components.
 */

export function getOperatorAdminKey(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem("alpha_operator_admin_key") || "ALPHA_ADMIN_REVERT_992";
  }
  return "ALPHA_ADMIN_REVERT_992";
}

export function getAdminHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const key = getOperatorAdminKey();
  return {
    "x-admin-key": key,
    "Authorization": `Bearer ${key}`,
    ...extraHeaders
  };
}
