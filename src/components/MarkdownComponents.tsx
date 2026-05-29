"use client";

import type { ComponentType, ReactNode } from "react";
import type { Components } from "react-markdown";
import {
  SiApplemusic,
  SiAudiomack,
  SiBandcamp,
  SiBandlab,
  SiBeatport,
  SiDeezer,
  SiDiscord,
  SiFacebook,
  SiInstagram,
  SiMastodon,
  SiPandora,
  SiPatreon,
  SiPinterest,
  SiReddit,
  SiSnapchat,
  SiSoundcloud,
  SiSpotify,
  SiThreads,
  SiTidal,
  SiTiktok,
  SiTwitch,
  SiVimeo,
  SiX,
  SiYoutube,
  SiYoutubemusic,
} from "@icons-pack/react-simple-icons";

type SimpleIcon = ComponentType<{
  size?: number;
  color?: string;
  className?: string;
  title?: string;
}>;

type Brand = {
  Icon: SimpleIcon;
  color: string;
  aliases: string[];
};

// Brand colors are the official primary brand color. For brands whose primary is
// black or near-black we substitute a light value so the icon stays visible on
// our dark UI.
const BRANDS: Brand[] = [
  { Icon: SiSpotify, color: "#1DB954", aliases: ["Spotify", "Spotify for Artists"] },
  { Icon: SiApplemusic, color: "#FA243C", aliases: ["Apple Music"] },
  { Icon: SiYoutube, color: "#FF0000", aliases: ["YouTube", "YT"] },
  { Icon: SiYoutubemusic, color: "#FF0000", aliases: ["YouTube Music", "YT Music"] },
  { Icon: SiTiktok, color: "#EE1D52", aliases: ["TikTok"] },
  { Icon: SiInstagram, color: "#E4405F", aliases: ["Instagram", "IG"] },
  { Icon: SiThreads, color: "#FFFFFF", aliases: ["Threads"] },
  { Icon: SiX, color: "#FFFFFF", aliases: ["X", "Twitter"] },
  { Icon: SiFacebook, color: "#1877F2", aliases: ["Facebook", "FB", "Meta"] },
  { Icon: SiSnapchat, color: "#FFFC00", aliases: ["Snapchat", "Snap"] },
  { Icon: SiPinterest, color: "#BD081C", aliases: ["Pinterest"] },
  { Icon: SiReddit, color: "#FF4500", aliases: ["Reddit"] },
  { Icon: SiDiscord, color: "#5865F2", aliases: ["Discord"] },
  { Icon: SiTwitch, color: "#9146FF", aliases: ["Twitch"] },
  { Icon: SiSoundcloud, color: "#FF5500", aliases: ["SoundCloud"] },
  { Icon: SiDeezer, color: "#A238FF", aliases: ["Deezer"] },
  { Icon: SiTidal, color: "#FFFFFF", aliases: ["Tidal"] },
  { Icon: SiPandora, color: "#00A0EE", aliases: ["Pandora"] },
  { Icon: SiAudiomack, color: "#FFA200", aliases: ["Audiomack"] },
  { Icon: SiBandcamp, color: "#629AA9", aliases: ["Bandcamp"] },
  { Icon: SiBandlab, color: "#FF0033", aliases: ["BandLab"] },
  { Icon: SiBeatport, color: "#01FF95", aliases: ["Beatport"] },
  { Icon: SiPatreon, color: "#F96854", aliases: ["Patreon"] },
  { Icon: SiVimeo, color: "#1AB7EA", aliases: ["Vimeo"] },
  { Icon: SiMastodon, color: "#6364FF", aliases: ["Mastodon"] },
];

function getNodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return getNodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function findBrand(text: string): Brand | null {
  if (!text) return null;
  for (const brand of BRANDS) {
    for (const alias of brand.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:^|[\\s,/])${escaped}(?:$|[\\s,/.])`, "i");
      if (re.test(` ${text} `)) return brand;
    }
  }
  return null;
}

function BrandCell({
  brand,
  children,
}: {
  brand: Brand;
  children: ReactNode;
}) {
  const { Icon, color } = brand;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={14} color={color} className="shrink-0" />
      <span>{children}</span>
    </span>
  );
}

export const markdownComponents: Components = {
  table: ({ children, ...props }) => (
    <div className="border-border bg-popover/40 !my-4 w-full overflow-x-auto rounded-md border">
      <table className="w-full min-w-full table-auto border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-muted/40 [&_tr]:w-full" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="[&_tr]:w-full" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="border-border w-full border-b last:border-0" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => {
    const text = getNodeText(children);
    const brand = findBrand(text);
    return (
      <th
        className="text-muted-foreground border-border border-b px-3 py-2 text-left text-[11px] font-semibold tracking-wide break-words uppercase"
        {...props}
      >
        {brand ? <BrandCell brand={brand}>{children}</BrandCell> : children}
      </th>
    );
  },
  td: ({ children, ...props }) => {
    const text = getNodeText(children);
    const brand = findBrand(text);
    return (
      <td className="text-foreground/90 px-3 py-2 align-top break-words" {...props}>
        {brand ? <BrandCell brand={brand}>{children}</BrandCell> : children}
      </td>
    );
  },
};
