/** Connector v4 signs the UTF-8 byte count, including for non-ASCII messages. */
export function organizationMessageBytes(message: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return encoder.encode(`midnight_signed_message:${encoder.encode(message).byteLength}:` + message);
}
