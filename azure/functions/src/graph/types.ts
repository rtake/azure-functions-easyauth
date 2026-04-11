/**
 * Microsoft Graph API の応答型
 */
export type GraphMeResponse = {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
};
