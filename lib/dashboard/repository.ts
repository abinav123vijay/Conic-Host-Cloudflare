import { ObjectId } from 'mongodb';
import { BUSINESS_ID } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';
import type { DailyEntry, PurchaseEntry } from '@/types/domain';

const clean = (x: unknown) => (x === undefined || x === null ? '' : x);

export async function listDaily() {
  const db = await getDb();
  return db.collection<DailyEntry>('dailyEntries').find({ businessId: BUSINESS_ID }).sort({ date: 1 }).toArray();
}
export async function upsertDaily(payload: Omit<DailyEntry, '_id'|'businessId'|'createdAt'|'updatedAt'>, id?: string) {
  const db = await getDb(); const now = new Date();
  const doc = { ...payload, businessId: BUSINESS_ID, updatedAt: now };
  if (id) { await db.collection('dailyEntries').updateOne({ _id: new ObjectId(id), businessId: BUSINESS_ID }, { $set: doc, $setOnInsert: { createdAt: now } }, { upsert: true }); return id; }
  const result = await db.collection('dailyEntries').insertOne({ ...doc, createdAt: now }); return result.insertedId.toString();
}
export async function deleteDaily(id: string) { const db = await getDb(); await db.collection('dailyEntries').deleteOne({ _id: new ObjectId(id), businessId: BUSINESS_ID }); }

export async function listPurchases() {
  const db = await getDb();
  return db.collection<PurchaseEntry>('purchaseEntries').find({ businessId: BUSINESS_ID }).sort({ purchaseDate: 1 }).toArray();
}
export async function upsertPurchase(payload: Omit<PurchaseEntry, '_id'|'businessId'|'createdAt'|'updatedAt'>, id?: string) {
  const db = await getDb(); const now = new Date();
  const doc = { ...payload, businessId: BUSINESS_ID, paymentDate: clean(payload.paymentDate) || null, updatedAt: now };
  if (id) { await db.collection('purchaseEntries').updateOne({ _id: new ObjectId(id), businessId: BUSINESS_ID }, { $set: doc }, { upsert: true }); return id; }
  const result = await db.collection('purchaseEntries').insertOne({ ...doc, createdAt: now }); return result.insertedId.toString();
}
export async function deletePurchase(id: string) { const db = await getDb(); await db.collection('purchaseEntries').deleteOne({ _id: new ObjectId(id), businessId: BUSINESS_ID }); }
