import { NextResponse } from 'next/server';
import { recordPodcastEvent, type PodcastEventName } from '../../../../lib/podcast-store';

export const dynamic = 'force-dynamic';

interface PodcastEvent {
  event?: string;
  podcastId?: string;
  podcastTitle?: string;
  podcastScore?: number;
  newsletterDate?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PodcastEvent;
    if (!body.event || !['podcast_impression', 'podcast_click'].includes(body.event)) {
      return NextResponse.json({ error: 'Invalid podcast event' }, { status: 400 });
    }
    if (!body.podcastId || !body.podcastTitle) {
      return NextResponse.json({ error: 'Missing podcast identity' }, { status: 400 });
    }

    // One document per podcast: an impression or click bumps its counter.
    await recordPodcastEvent({
      event: body.event as PodcastEventName,
      podcastId: body.podcastId,
      podcastTitle: body.podcastTitle,
      podcastScore: typeof body.podcastScore === 'number' ? body.podcastScore : undefined,
      newsletterDate: body.newsletterDate,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
