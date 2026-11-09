import '@opennextjs/cloudflare';

declare global {
  interface CloudflareEnv {
    MONGODB_URI?: string;
    MONGODB_DB?: string;
  }
}

export {};
