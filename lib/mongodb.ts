import { MongoClient, Db } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var __conicMongoClient: MongoClient | undefined;
  // eslint-disable-next-line no-var
  var __conicMongoDb: Db | undefined;
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'conic';

if (!uri) throw new Error('MONGODB_URI is not configured. Copy .env.example to .env.local.');

export async function getDb(): Promise<Db> {
  if (global.__conicMongoDb) return global.__conicMongoDb;
  if (!global.__conicMongoClient) global.__conicMongoClient = new MongoClient(uri, { appName: 'CONIC' });
  await global.__conicMongoClient.connect();
  global.__conicMongoDb = global.__conicMongoClient.db(dbName);
  return global.__conicMongoDb;
}
