import Image from 'next/image';
import { ExternalLink } from 'lucide-react';

const LOGIN_GIF = 'https://media.giphy.com/media/xLsaBMK6Mg8DK/giphy.gif';

export function DumpsterFireHero() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <Image
        src={LOGIN_GIF}
        alt=""
        fill
        sizes="100vw"
        loading="eager"
        unoptimized
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-black/30 sm:bg-gradient-to-r sm:from-black/65 sm:via-black/20 sm:to-black/10" />
      <a
        href="https://giphy.com/gifs/check-it-out-dr-steve-brule-xLsaBMK6Mg8DK"
        target="_blank"
        rel="noreferrer"
        className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-white/60 transition hover:text-white"
      >
        GIPHY
        <ExternalLink className="h-2.5 w-2.5" aria-hidden />
      </a>
    </div>
  );
}
