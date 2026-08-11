import Image from 'next/image';
import { ExternalLink } from 'lucide-react';

const REQUEST_ACCESS_GIF = 'https://media.giphy.com/media/B7aksBgcJzFDO/giphy.gif';

export function RequestAccessHero() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <Image
        src={REQUEST_ACCESS_GIF}
        alt=""
        fill
        sizes="100vw"
        loading="eager"
        unoptimized
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-black/35 sm:bg-gradient-to-r sm:from-black/60 sm:via-black/25 sm:to-black/45" />
      <a
        href="https://giphy.com/gifs/ace-ventura-funny-dog-B7aksBgcJzFDO"
        target="_blank"
        rel="noreferrer"
        className="absolute right-3 bottom-3 z-20 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-white/60 transition hover:text-white"
      >
        GIPHY
        <ExternalLink className="h-2.5 w-2.5" aria-hidden />
      </a>
    </div>
  );
}
