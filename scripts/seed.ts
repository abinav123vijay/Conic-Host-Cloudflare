import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { loadConicEnv } from './load-env';
import seed from '../data/seed.json';

void fs;
void path;

async function main() {
  loadConicEnv();
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'conic';

  if (!uri) {
    throw new Error('Set MONGODB_URI before running npm run seed.');
  }

  const client = new MongoClient(uri, { appName: 'CONIC-seed' });

  try {
    await client.connect();
    const db = client.db(dbName);

    await db.collection('businesses').updateOne(
      { _id: 'conic-main' },
      {
        $set: {
          _id: 'conic-main',
          ...seed.settings,
          name: seed.business.name,
          currency: 'INR',
          dateFormat: 'DD-MMM-YYYY',
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    await db.collection('dailyEntries').deleteMany({ businessId: 'conic-main' });
    if (seed.dailyEntries.length) {
      await db.collection('dailyEntries').insertMany(
        seed.dailyEntries.map((x: any) => ({
          businessId: 'conic-main',
          ...x,
          createdAt: new Date(),
          updatedAt: new Date()
        }))
      );
    }

    await db.collection('purchaseEntries').deleteMany({ businessId: 'conic-main' });
    if (seed.purchaseEntries.length) {
      await db.collection('purchaseEntries').insertMany(
        seed.purchaseEntries.map((x: any) => ({
          businessId: 'conic-main',
          ...x,
          createdAt: new Date(),
          updatedAt: new Date()
        }))
      );
    }

    await db.collection('dailyEntries').createIndex({ businessId: 1, date: 1 });
    await db.collection('purchaseEntries').createIndex({ businessId: 1, purchaseDate: 1 });
    await db.collection('purchaseEntries').createIndex({ businessId: 1, paymentDate: 1 });

    console.log(
      `Seeded CONIC: ${seed.dailyEntries.length} daily entries, ${seed.purchaseEntries.length} purchase entries.`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
