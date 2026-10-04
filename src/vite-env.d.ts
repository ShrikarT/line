/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LINE_RUNTIME?: string;
  readonly VITE_MIDNIGHT_NETWORK_ID?: string;
  readonly VITE_MIDNIGHT_INDEXER_URI?: string;
  readonly VITE_MIDNIGHT_NODE_URI?: string;
  readonly VITE_MIDNIGHT_CONTRACT_ADDRESS?: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*line-mcp.mjs" {
  export const handleMessage: (msg: any) => Promise<any>;
}
