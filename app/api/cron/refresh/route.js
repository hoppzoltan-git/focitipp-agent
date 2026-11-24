import { runRefresh } from '../../../../lib/refresh';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// A Vercel Cron hívja minden nap; a CRON_SECRET védi.
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Nincs jogosultság.' }, { status: 401 });
  }
  try {
    return Response.json(await runRefresh());
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
