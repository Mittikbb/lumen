import { Sky } from "./conditions";

const SUN = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </>
);
const MOON = <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />;
const CLOUD = <path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 18z" />;
const SMALL_CLOUD = <path d="M9 19h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 9 19z" />;

/** Line icon for a sky; the sun turns into the moon at night. */
export function WeatherIcon({ sky, day = true, className }: { sky: Sky; day?: boolean; className?: string }) {
  let body;
  switch (sky) {
    case "clear":
      body = day ? SUN : MOON;
      break;
    case "partly":
      body = (
        <>
          <g transform="translate(-3 -3) scale(0.75)">{day ? SUN : MOON}</g>
          {SMALL_CLOUD}
        </>
      );
      break;
    case "cloudy":
      body = CLOUD;
      break;
    case "fog":
      body = <path d="M4 9h16M6 13h12M4 17h16" />;
      break;
    case "drizzle":
      body = (
        <>
          <g transform="translate(0 -3)">{CLOUD}</g>
          <path d="M9 19v1M13 19v1M17 19v1" />
        </>
      );
      break;
    case "rain":
      body = (
        <>
          <g transform="translate(0 -3)">{CLOUD}</g>
          <path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" />
        </>
      );
      break;
    case "snow":
      body = (
        <>
          <g transform="translate(0 -3)">{CLOUD}</g>
          <path d="M9 19.5h.01M13 21h.01M17 19.5h.01" strokeWidth="2.6" />
        </>
      );
      break;
    case "storm":
      body = (
        <>
          <g transform="translate(0 -3)">{CLOUD}</g>
          <path d="M13 16l-2 3h3l-2 3" />
        </>
      );
      break;
  }
  return (
    <svg className={`wx-icon wx-${sky}${className ? ` ${className}` : ""}`} viewBox="0 0 24 24" aria-hidden>
      {body}
    </svg>
  );
}
