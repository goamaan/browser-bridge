import type { BrowserBridgeClient } from '@goamaan/browser-bridge-sdk';

export default async function run(client: BrowserBridgeClient): Promise<unknown> {
  return await client.status();
}
