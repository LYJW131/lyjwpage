import { Heart } from "lucide-react";
import type { MetaDescriptor } from "react-router";

import Image from "@/components/app-image";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { appleArtwork, ARTWORK_SCALE } from "@/lib/apple-artwork";
import { cn } from "@/lib/utils";
import { site } from "@shared/site";

import replay from "./fixture.json";

export function meta(): MetaDescriptor[] {
  return [
    { title: `Apple Music Lab — ${site.name}` },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

const releaseDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Artwork({ url, px, className }: { url: string | null | undefined; px: number; className?: string }) {
  const src = appleArtwork(url, px * ARTWORK_SCALE);
  return (
    <div className={cn("relative shrink-0 overflow-hidden border border-line bg-muted", className)}>
      {src && <Image src={src} alt="" fill sizes={`${px}px`} className="object-cover" unoptimized />}
    </div>
  );
}

function Rank({ n }: { n: number }) {
  return <span className="w-5 shrink-0 text-xs text-muted-foreground">{n}</span>;
}

function TopSongsCard() {
  const [first, ...rest] = replay.topSongs;
  return (
    <Card label={`Replay ${replay.year}`} action={`Top ${replay.songCount}`}>
      <div className="flex flex-col gap-4 p-4 lg:gap-5 lg:p-5">
        <a href={first.url} className="flex items-end gap-4">
          <Artwork url={first.artwork} px={112} className="size-28" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="label-mono text-muted-foreground">No. 1 Song</span>
            <span className="text-lg font-semibold text-balance lg:text-xl">{first.title}</span>
            <span className="truncate text-xs text-muted-foreground">{first.artist}</span>
          </div>
        </a>
        <ol className="flex flex-col">
          {rest.slice(0, 5).map((song) => (
            <li key={song.rank}>
              <a href={song.url} className="-mx-2 flex h-12 items-center gap-2 px-2 hover:bg-surface-hover">
                <Rank n={song.rank} />
                <Artwork url={song.artwork} px={40} className="size-10" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{song.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{song.artist}</div>
                </div>
                {song.loved && <Heart aria-label="Loved" className="size-3.5 shrink-0 fill-current text-signal-red" />}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function TopArtistsCard() {
  return (
    <Card label="Top Artists" action={`${replay.artistCount} Artists`}>
      <ol className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:gap-4 lg:p-5">
        {replay.topArtists.map((artist) => (
          <li key={artist.rank}>
            <a href={artist.url} className="flex flex-col gap-2">
              <Artwork url={artist.artwork} px={140} className="aspect-square w-full" />
              <div className="flex min-w-0 items-baseline gap-1">
                <span className="text-xs text-muted-foreground">{artist.rank}</span>
                <span className="truncate text-sm font-medium">{artist.name}</span>
              </div>
            </a>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function TopAlbumsCard() {
  return (
    <Card label="Top Albums" action={`${replay.albumCount} Albums`}>
      <ol className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:gap-4 lg:p-5">
        {replay.topAlbums.map((album) => (
          <li key={album.rank}>
            <a href={album.url} className="flex flex-col gap-2">
              <Artwork url={album.artwork} px={140} className="aspect-square w-full" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{album.title}</span>
                <span className="truncate text-xs text-muted-foreground">{album.artist}</span>
              </div>
            </a>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function NewReleasesCard() {
  const releases = [...replay.latestReleases].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  return (
    <Card label="New From Favorites" action="Apple Music">
      <ol className="flex flex-col p-4 lg:p-5">
        {releases.map((release) => (
          <li key={release.url}>
            <a href={release.url} className="-mx-2 flex h-14 items-center gap-3 px-2 hover:bg-surface-hover">
              <Artwork url={release.artwork} px={44} className="size-11" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{release.title}</div>
                <div className="truncate text-xs text-muted-foreground">{release.artist}</div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {releaseDate.format(new Date(release.releaseDate))}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function AppleMusicLabPage() {
  return (
    <main className="mx-auto w-[calc(100%-2rem)] max-w-5xl">
      <Section label="Lab" title="Apple Music">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TopSongsCard />
          <TopAlbumsCard />
          <TopArtistsCard />
          <NewReleasesCard />
        </div>
      </Section>
    </main>
  );
}
