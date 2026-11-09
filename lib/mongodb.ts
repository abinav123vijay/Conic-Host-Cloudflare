import { MongoClient, Db } from 'mongodb';
import { getCloudflareContext } from '@opennextjs/cloudflare';

declare global {
  // eslint-disable-next-line no-var
  var __conicMongoClient: MongoClient | undefined;
  // eslint-disable-next-line no-var
  var __conicMongoDb: Db | undefined;
}

const uri = process.env.MONGODB_URI ?? '';
const dbName = process.env.MONGODB_DB || 'conic';

const workerDatabases = new WeakMap<object, Promise<Db>>();

function isMissingCloudflareContext(error: unknown) {
  return error instanceof Error &&
    error.message.includes('has been called without having called') &&
    error.message.includes('initOpenNextCloudflareForDev');
}

async function getWorkerDb() {
  const context = await getCloudflareContext({ async: true });
  const requestContext = context.ctx;
  const cached = workerDatabases.get(requestContext);
  if (cached) return cached;

  const workerUri = context.env.MONGODB_URI;
  if (!workerUri) throw new Error('MONGODB_URI is not configured as a Cloudflare Worker secret.');

  const workerDbName = context.env.MONGODB_DB || 'conic';
  const database = new MongoClient(workerUri, { appName: 'CONIC' })
    .connect()
    .then(client => client.db(workerDbName));
  workerDatabases.set(requestContext, database);
  return database;
}

export async function getDb(): Promise<Db> {
  try {
    return await getWorkerDb();
  } catch (error) {
    if (!isMissingCloudflareContext(error)) throw error;
  }

  if (global.__conicMongoDb) return global.__conicMongoDb;
  if (!uri) throw new Error('MONGODB_URI is not configured. Copy .env.example to .env.local.');
  if (!global.__conicMongoClient) global.__conicMongoClient = new MongoClient(uri, { appName: 'CONIC' });
  await global.__conicMongoClient.connect();
  global.__conicMongoDb = global.__conicMongoClient.db(dbName);
  return global.__conicMongoDb;
}
