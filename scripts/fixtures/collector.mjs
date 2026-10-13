import { WorkerEntrypoint } from 'cloudflare:workers';
import { trackKeyOf, upcomingKeyOf } from '../../shared/track-enrichment.ts';

function fixtureEnrichment(music, motion = null) {
  const slug = encodeURIComponent(music.title);
  return {
    trackKey: trackKeyOf(music), id: `fixture-album-${slug}`, link: `https://music.apple.com/us/song/${slug}/1`, songId: `fixture-${slug}`,
    artwork: `https://fixture.invalid/${slug}.jpg`, hasLyrics: false, upcomingSongIds: [], motion,
  };
}

// 写入时故意不给动态封面（motionKnown: false），让上报入口在回执后调 followUpTrack，补写再经 StateCore 进状态核心。
export class Collector extends WorkerEntrypoint {
  async refresh() {
    return [];
  }

  async enrichTrack(music) {
    if (!music?.title || music.state === 'stopped') return null;
    return { enrichment: fixtureEnrichment(music), catalogKnown: true, upcomingKnown: true, motionKnown: false };
  }

  async followUpTrack({ target, music, upcomingTracks }) {
    const motion = { videoUrl: `https://fixture.invalid/${encodeURIComponent(music.title)}.m3u8`, colors: null };
    this.ctx.waitUntil(this.env.CORE.commitEnrichmentPatch({ target, enrichment: fixtureEnrichment(music, motion), upcomingKey: upcomingKeyOf(upcomingTracks) }));
  }
}

export default {
  fetch() {
    return new Response('collector fixture', { status: 404 });
  },
};
