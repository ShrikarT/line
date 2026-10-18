export function organizationSignInMessage(origin: string, address: string, nonce: string, expiresAt: number): string {
  return `Sign in to Line\nOrigin: ${origin}\nNetwork: preprod\nWallet: ${address}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nThis signature authorizes access to your organization orders. It does not authorize a payment.`;
}
