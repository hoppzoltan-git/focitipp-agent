import { runRefresh } from '../../../lib/refresh';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Kézi frissítés a "Frissítés most" gombbal (a jelszavas védelem mögött).
export async function POST() {
  try {
    return Response.json(await runRefresh());
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
