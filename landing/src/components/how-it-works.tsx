import { cn } from "@warden/ui/lib/utils";
import styles from "@/components/how-it-works.module.css";
import { Eyebrow, Heading, Section } from "@/components/section";

/** Rack bays: two LEDs per row blink at their own period (seconds); a stopped bay has none. */
const BAYS = [
  { name: "survival-main", mem: "8192 MB", leds: [1.1, 0.7] },
  { name: "creative-build", mem: "4096 MB", leds: [1.7, 0.45] },
  { name: "fabric-test", mem: "2048 MB", leds: [0.7, 2.3] },
  { name: "lobby", mem: "stopped", leds: [] },
];
const LED_COLORS = ["#10b981", "#f59e0b"];

function ServerTower() {
  return (
    <g transform="translate(120 20)">
      <rect x="0" y="120" width="360" height="400" rx="20" fill="#353535" stroke="rgba(255,255,255,0.12)" />
      <g transform="translate(180 120)">
        <circle className={styles.ring} r="40" fill="none" stroke="#5eead4" strokeWidth="1.5" />
        <circle className={cn(styles.ring, styles.ring2)} r="40" fill="none" stroke="#5eead4" strokeWidth="1.5" />
      </g>
      {/* Stylised voxel guardian (original artwork, not a game asset). */}
      <g className={styles.sniff}>
        <ellipse cy="8" rx="80" ry="40" fill="url(#hiw-soul)" className={styles.soul} />
        <g transform="translate(-60 -150)">
          <rect x="8" y="-10" width="14" height="34" rx="3" fill="#0f766e" />
          <rect x="98" y="-10" width="14" height="34" rx="3" fill="#0f766e" />
          <rect x="14" y="18" width="92" height="62" rx="8" fill="#0b2a2e" />
          <rect x="26" y="36" width="68" height="14" rx="4" fill="#062024" />
          <rect x="34" y="40" width="10" height="6" rx="2" fill="#5eead4" className={styles.soul} />
          <rect x="76" y="40" width="10" height="6" rx="2" fill="#5eead4" className={styles.soul} />
          <rect x="0" y="84" width="120" height="96" rx="10" fill="#0f3a3f" />
          <rect x="42" y="100" width="36" height="52" rx="6" fill="#062024" />
          <rect x="52" y="112" width="16" height="10" rx="2" fill="#5eead4" className={styles.soul} />
          <rect x="52" y="128" width="16" height="10" rx="2" fill="#5eead4" className={styles.soul} />
          <rect x="-30" y="88" width="26" height="110" rx="8" fill="#0b2a2e" />
          <rect x="124" y="88" width="26" height="110" rx="8" fill="#0b2a2e" />
          <rect x="-30" y="170" width="26" height="28" rx="6" fill="#a8b5a0" />
          <rect x="124" y="170" width="26" height="28" rx="6" fill="#a8b5a0" />
          <rect x="14" y="182" width="38" height="58" rx="8" fill="#0b2a2e" />
          <rect x="68" y="182" width="38" height="58" rx="8" fill="#0b2a2e" />
        </g>
      </g>
      <g transform="translate(30 300)" className="font-mono" fontSize="13">
        {BAYS.map((b, row) => {
          const off = b.leds.length === 0;
          return (
            <g key={b.name} transform={`translate(0 ${row * 50})`}>
              <rect width="300" height="42" rx="10" fill="#252525" stroke="rgba(255,255,255,0.10)" />
              {[0, 1].map((i) => (
                <circle
                  key={i}
                  cx={20 + i * 14}
                  cy="21"
                  r="4"
                  fill={off ? "#444444" : LED_COLORS[i]}
                  className={off ? undefined : styles.led}
                  style={off ? undefined : { animationDuration: `${b.leds[i]}s` }}
                />
              ))}
              <text x="52" y="26" fill={off ? "#8a8a8a" : "#fcfcfc"}>
                {b.name}
              </text>
              <text x="220" y="26" fill="#8a8a8a">
                {b.mem}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}

function Connection() {
  return (
    <g transform="translate(675 330)">
      <g transform="translate(-22 -78)">
        <path
          d="M22 0 4 7v12c0 11 7.6 21 18 25 10.4-4 18-14 18-25V7L22 0z"
          fill="rgba(94,234,212,0.12)"
          stroke="#5eead4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M24 10 14 25h8l-2 12 10-15h-8l2-12z" fill="#5eead4" />
      </g>
      <text y="-18" textAnchor="middle" fill="#fcfcfc" fontSize="15" fontWeight="600" className="font-sans">
        Real-time, secure connection
      </text>
      <text y="2" textAnchor="middle" className={styles.lbl}>
        WebSocket + REST · TLS · short-lived JWT
      </text>
      <line
        className={styles.wire}
        x1="-130"
        y1="40"
        x2="130"
        y2="40"
        markerStart="url(#hiw-ah)"
        markerEnd="url(#hiw-ah)"
      />
      <text y="66" textAnchor="middle" className={styles.lbl}>
        console · metrics · events · commands
      </text>
    </g>
  );
}

const BROWSER_LOG = [
  { y: 0, text: "[12:07:12 INFO]: Steve joined the game", fill: "#d4d4d4" },
  { y: 13, text: "[12:06:41 WARN]: Can't keep up! Running 2314ms behind", fill: "#f59e0b" },
  { y: 26, text: "> tps", fill: "#22d3ee" },
  { y: 39, text: "[12:08:00 INFO]: TPS from last 1m, 5m, 15m: 19.97, 19.98, 20.0", fill: "#d4d4d4" },
];

const BROWSER_TILES = [
  { x: 0, label: "CPU", value: "31.2 %" },
  { x: 84, label: "RAM", value: "5.1G/8G" },
  { x: 168, label: "Network", value: "↓390K ↑1.0M" },
  { x: 252, label: "TPS", value: "19.9" },
];

/** Safari-like window showing Beacon on the instance's Metrics section, with the beacon block lighting it. */
function BrowserWindow() {
  return (
    <g transform="translate(870 0)">
      {/* beacon block + soft beam */}
      <g transform="translate(180 96)">
        <path d="M-26 -14 L26 -14 L70 -190 L-70 -190 Z" fill="url(#hiw-beam)" className={styles.beam} />
        <g className={styles.hover}>
          <polygon points="0,-40 34,-21 0,-2 -34,-21" fill="#1f4d4a" stroke="#5eead4" strokeWidth="1.5" />
          <polygon points="-34,-21 0,-2 0,36 -34,17" fill="#0f2f2e" stroke="#5eead4" strokeWidth="1.5" />
          <polygon points="34,-21 0,-2 0,36 34,17" fill="#163d3b" stroke="#5eead4" strokeWidth="1.5" />
          <polygon points="0,-27 18,-17 0,-7 -18,-17" fill="#5eead4" className={styles.soul} />
        </g>
      </g>
      {/* window chrome */}
      <rect
        x="0"
        y="140"
        width="360"
        height="400"
        rx="14"
        fill="#353535"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="1.5"
      />
      <rect x="1" y="141" width="358" height="36" rx="13" fill="#3d3d3d" />
      <rect x="1" y="162" width="358" height="15" fill="#3d3d3d" />
      <circle cx="18" cy="159" r="5" fill="#ff5f57" />
      <circle cx="34" cy="159" r="5" fill="#febc2e" />
      <circle cx="50" cy="159" r="5" fill="#28c840" />
      <rect x="84" y="149" width="192" height="20" rx="6" fill="#2a2a2a" />
      <path d="M96 159 l2.5 -3 M96 159 l2.5 3" stroke="#8a8a8a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <text x="180" y="163" textAnchor="middle" fill="#b3b3b3" fontSize="9" className="font-sans">
        Warden Beacon
      </text>
      <line x1="1" y1="177" x2="359" y2="177" stroke="rgba(255,255,255,0.10)" />
      {/* page */}
      <rect x="1" y="178" width="358" height="361" rx="0" fill="#252525" />
      <text x="20" y="214" fill="#fcfcfc" fontSize="13" fontWeight="600" className="font-sans">
        survival-main
      </text>
      <rect x="112" y="203" width="46" height="13" rx="6" fill="rgba(5,150,105,0.15)" stroke="rgba(5,150,105,0.30)" />
      <text x="119" y="213" fill="#10b981" fontSize="8" className="font-sans">
        running
      </text>
      <rect x="292" y="201" width="48" height="18" rx="6" fill="#444444" />
      <text x="316" y="213" textAnchor="middle" fill="#fcfcfc" fontSize="8" className="font-sans">
        Restart
      </text>
      <g transform="translate(20 228)" className="font-mono" fontSize="8">
        {BROWSER_TILES.map((t) => (
          <g key={t.label} transform={`translate(${t.x} 0)`}>
            <rect width="76" height="38" rx="8" fill="#353535" />
            <text x="8" y="14" fill="#8a8a8a">
              {t.label}
            </text>
            <text x="8" y="29" fill="#fcfcfc" fontSize="10">
              {t.value}
            </text>
          </g>
        ))}
      </g>
      <text x="20" y="290" fill="#8a8a8a" fontSize="9" className="font-sans">
        Metrics · last hour
      </text>
      <rect x="20" y="298" width="320" height="110" rx="10" fill="#353535" />
      <path
        className="draw"
        d="M32 360 L60 356 L88 362 L116 336 L144 348 L172 326 L200 356 L228 340 L256 348 L284 330 L312 342 L328 338"
        fill="none"
        stroke="#fcfcfc"
        strokeWidth="1.5"
      />
      <path
        className="draw"
        d="M32 388 L60 382 L88 390 L116 378 L144 380 L172 370 L200 386 L228 380 L256 388 L284 374 L312 382 L328 380"
        fill="none"
        stroke="#8a8a8a"
        strokeWidth="1"
      />
      <rect x="20" y="420" width="320" height="104" rx="8" fill="#1c1c1c" />
      <g transform="translate(30 438)">
        {BROWSER_LOG.map((l) => (
          <text key={l.text} y={l.y} fill={l.fill} fontSize="7.5" className="font-console">
            {l.text}
          </text>
        ))}
      </g>
    </g>
  );
}

export function HowItWorks() {
  return (
    <Section className="flex flex-col gap-10">
      <div className="flex max-w-3xl flex-col items-center gap-2.5 self-center text-center">
        <Eyebrow>How it works</Eyebrow>
        <Heading>Warden guards the box. Beacon lights it up.</Heading>
      </div>
      <svg viewBox="0 -90 1280 710" className="block h-auto w-full" role="img" aria-labelledby="hiw-title">
        <title id="hiw-title">
          wardend runs the servers on the box; Beacon, in the browser, talks to it over a real-time secure connection.
        </title>
        <defs>
          <radialGradient id="hiw-soul" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#5eead4" stopOpacity="0.9" />
            <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hiw-beam" cx="50%" cy="100%" r="95%">
            <stop offset="0" stopColor="#5eead4" stopOpacity="0.9" />
            <stop offset="0.35" stopColor="#5eead4" stopOpacity="0.35" />
            <stop offset="0.7" stopColor="#5eead4" stopOpacity="0.08" />
            <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
          </radialGradient>
          <marker
            id="hiw-ah"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="#b3b3b3" />
          </marker>
        </defs>
        <ServerTower />
        <text x="300" y="585" textAnchor="middle" fill="#fcfcfc" fontSize="16" fontWeight="600" className="font-sans">
          wardend
        </text>
        <text x="300" y="606" textAnchor="middle" className={styles.lbl}>
          Go daemon on the box · supervises, samples, backs up
        </text>
        <Connection />
        <BrowserWindow />
        <text x="1050" y="585" textAnchor="middle" fill="#fcfcfc" fontSize="16" fontWeight="600" className="font-sans">
          Beacon
        </text>
        <text x="1050" y="606" textAnchor="middle" className={styles.lbl}>
          Next.js panel · installable PWA · signs in, then steps aside
        </text>
      </svg>
    </Section>
  );
}
