import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { createSessionToken, hashPassword, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

function matchesInviteCode(input: string, expected: string) {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);
  return inputBuffer.length === expectedBuffer.length && timingSafeEqual(inputBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; inviteCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Enter your email, password, and invite code.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode : '';
  const expectedInviteCode = process.env.AUTH_SIGNUP_CODE;

  if (!expectedInviteCode) {
    return NextResponse.json({ error: 'Sign-up is not enabled. Ask the administrator to configure an invite code.' }, { status: 503 });
  }
  if (!matchesInviteCode(inviteCode, expectedInviteCode)) {
    return NextResponse.json({ error: 'Invite code is invalid.' }, { status: 403 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 12 || password.length > 1024) {
    return NextResponse.json({ error: 'Use a password between 12 and 1024 characters.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await db.collection('users').findOne({ email: { $regex: `^${escapedEmail}$`, $options: 'i' } });
    if (existing) return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });

    const result = await db.collection('users').insertOne({
      email,
      passwordHash: await hashPassword(password),
      businessId: BUSINESS_ID,
      role: 'staff',
      createdAt: new Date()
    });
    const token = createSessionToken({ id: result.insertedId.toString(), email, businessId: BUSINESS_ID, role: 'staff' });
    const response = NextResponse.json({ ok: true }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS
    });
    return response;
  } catch (error) {
    console.error('Sign-up failed:', error);
    return NextResponse.json({ error: 'Sign-up is temporarily unavailable.' }, { status: 503 });
  }
}
