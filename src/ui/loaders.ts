// Inline loader spinners prepended to the thinking indicator. Each variant is
// scoped to its own .la-ld-N class with prefixed keyframes so they coexist in
// one stylesheet. Colors flow from Lumiverse theme tokens.

export const LOADER_VARIANTS: readonly string[] = [
  "la-ld-1",  "la-ld-2",  "la-ld-4",  "la-ld-5",  "la-ld-6",  "la-ld-7",
  "la-ld-8",  "la-ld-9",  "la-ld-10", "la-ld-11", "la-ld-12", "la-ld-13",
  "la-ld-14", "la-ld-15",
];

export function pickLoaderVariant(): string {
  return LOADER_VARIANTS[Math.floor(Math.random() * LOADER_VARIANTS.length)]!;
}

export const LOADERS_CSS = `
.la-ld {
  display: inline-block;
  vertical-align: middle;
  margin-right: 8px;
  flex-shrink: 0;
}

/* L1 — kiln bricks (35x80, tall) */
.la-ld-1 {
  zoom: 0.18;
  width: 35px;
  height: 80px;
  position: relative;
}
.la-ld-1:before {
  content: "";
  position: absolute;
  inset: 0 0 20px;
  padding: 1px;
  background:
    conic-gradient(from -90deg at calc(100% - 3px) 3px, var(--lumiverse-primary) 135deg, var(--lumiverse-primary-muted) 0 270deg, #0000 0),
    conic-gradient(from   0deg at 3px calc(100% - 3px), #0000 90deg, var(--lumiverse-primary-muted) 0 225deg, var(--lumiverse-primary) 0),
    var(--lumiverse-bg-deep);
  background-size: 17px 17px;
  background-clip: content-box;
  --c:no-repeat linear-gradient(#000 0 0);
  -webkit-mask:
      var(--c) 0    0,
      var(--c) 17px 0,
      var(--c) 0    17px,
      var(--c) 17px 17px,
      var(--c) 0    34px,
      var(--c) 17px 34px,
      linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
          mask-composite:exclude;
  animation: la-ldk-1 3s infinite;
}
.la-ld-1:after {
  content: "";
  position: absolute;
  inset: 60% 0 0;
  background: var(--lumiverse-primary-text);
  border-top: 5px solid var(--lumiverse-border);
}
@keyframes la-ldk-1 {
  0%,14%  {-webkit-mask-size: 0 0,0 0,0 0,0 0,0 0,0 0,auto}
  15%,29% {-webkit-mask-size: 17px 17px,0 0,0 0,0 0,0 0,0 0,auto}
  30%,44% {-webkit-mask-size: 17px 17px,17px 17px,0 0,0 0,0 0,0 0,auto}
  45%,59% {-webkit-mask-size: 17px 17px,17px 17px,17px 17px,0 0,0 0,0 0,auto}
  60%,74% {-webkit-mask-size: 17px 17px,17px 17px,17px 17px,17px 17px,0 0,0 0,auto}
  75%,89% {-webkit-mask-size: 17px 17px,17px 17px,17px 17px,17px 17px,17px 17px,0 0,auto}
  90%,100% {-webkit-mask-size: 17px 17px,17px 17px,17px 17px,17px 17px,17px 17px,17px 17px,auto}
}

/* L2 — rotating ellipse loops */
.la-ld-2 {
  zoom: 0.30;
  width: 25px;
  height: 50px;
  display: grid;
  color: var(--lumiverse-primary);
  background:
    linear-gradient(currentColor 0 0) top/100% 2px,
    radial-gradient(farthest-side at top, #0000 calc(100% - 2px),currentColor calc(100% - 1px) ,#0000) top,
    linear-gradient(currentColor 0 0) bottom/100% 2px,
    radial-gradient(farthest-side at bottom, #0000 calc(100% - 2px),currentColor calc(100% - 1px) ,#0000) bottom;
  background-size: 100% 1px,100% 50%;
  background-repeat: no-repeat;
  animation: la-ldk-2 4s infinite linear;
}
.la-ld-2::before, .la-ld-2::after {
  content: ""; grid-area: 1/1; background: inherit; border: inherit; animation: inherit;
}
.la-ld-2::after { animation-duration: 2s; }
@keyframes la-ldk-2 { 100% {transform: rotate(1turn)} }

/* L4 — chasing corner dots */
.la-ld-4 {
  zoom: 0.30;
  height: 40px;
  aspect-ratio: 1.5;
  --c: var(--lumiverse-primary) 96%,#0000;
  background:
    radial-gradient(farthest-side at 100% 100%,var(--c)),
    radial-gradient(farthest-side at 0    100%,var(--c)),
    radial-gradient(farthest-side at 100% 0   ,var(--c)),
    radial-gradient(farthest-side at 0    0   ,var(--c));
  background-size: 33.4% 50%;
  background-repeat: no-repeat;
  animation: la-ldk-4 2s infinite linear;
}
@keyframes la-ldk-4 {
  0%    {background-position:0 0,50% 0,0 100%,50% 100%}
  12.5% {background-position:0 0,100% 0,0 100%,50% 100%}
  25%   {background-position:50% 0,100% 0,0 100%,50% 100%}
  37.5% {background-position:50% 0,100% 0,0 100%,100% 100%}
  50%   {background-position:50% 0,100% 0,50% 100%,100% 100%}
  62.5% {background-position:0 0,100% 0,50% 100%,100% 100%}
  75%   {background-position:0 0,50% 0,50% 100%,100% 100%}
  87.5% {background-position:0 0,50% 0,0 100%,100% 100%}
  100%  {background-position:0 0,50% 0,0 100%,50% 100%}
}

/* L5 — yin-yang style sweep */
.la-ld-5 {
  zoom: 0.25;
  --r1: 154%;
  --r2: 68.5%;
  width: 60px;
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(var(--r1) var(--r2) at top   ,#0000 79.5%,var(--lumiverse-primary) 80%),
    radial-gradient(var(--r1) var(--r2) at bottom,var(--lumiverse-primary) 79.5%,#0000 80%),
    radial-gradient(var(--r1) var(--r2) at top   ,#0000 79.5%,var(--lumiverse-primary) 80%),
    var(--lumiverse-primary-muted);
  background-size: 50.5% 220%;
  background-position: -100% 0%,0% 0%,100% 0%;
  background-repeat:no-repeat;
  animation: la-ldk-5 2s infinite linear;
}
@keyframes la-ldk-5 {
  33%  {background-position:    0% 33% ,100% 33% ,200% 33% }
  66%  {background-position: -100%  66%,0%   66% ,100% 66% }
  100% {background-position:    0% 100%,100% 100%,200% 100%}
}

/* L6 — rotating plus */
.la-ld-6 {
  zoom: 0.30;
  width: 50px;
  aspect-ratio: 1;
  display: grid;
  color: var(--lumiverse-primary);
  background:
    linear-gradient(90deg,currentColor 2px,#0000 0 calc(100% - 2px),currentColor 0) center/100% 14px,
    linear-gradient(0deg, currentColor 2px,#0000 0 calc(100% - 2px),currentColor 0) center/14px 100%,
    linear-gradient(currentColor 0 0) center/100% 2px,
    linear-gradient(currentColor 0 0) center/2px 100%;
  background-repeat: no-repeat;
  animation: la-ldk-6 4s infinite linear;
}
.la-ld-6::before, .la-ld-6::after {
  content: ""; grid-area: 1/1; background: inherit; transform-origin: inherit; animation: inherit;
}
.la-ld-6::after { animation-duration: 2s; }
@keyframes la-ldk-6 { 100% {transform:rotate(1turn)} }

/* L7 — square+circle dual orbit */
.la-ld-7 {
  zoom: 0.22;
  width: 65px;
  aspect-ratio: 1;
  position: relative;
}
.la-ld-7:before, .la-ld-7:after {
  content: ""; position: absolute;
  border-radius: 50px;
  box-shadow: 0 0 0 3px inset var(--lumiverse-primary);
  animation: la-ldk-7 2.5s infinite;
}
.la-ld-7:after { animation-delay: -1.25s; border-radius: 0; }
@keyframes la-ldk-7 {
  0%    {inset:0    35px 35px 0   }
  12.5% {inset:0    35px 0    0   }
  25%   {inset:35px 35px 0    0   }
  37.5% {inset:35px 0    0    0   }
  50%   {inset:35px 0    0    35px}
  62.5% {inset:0    0    0    35px}
  75%   {inset:0    0    35px 35px}
  87.5% {inset:0    0    35px 0   }
  100%  {inset:0    35px 35px 0   }
}

/* L8 — wobbling face */
.la-ld-8 {
  zoom: 0.22;
  width: 50px;
  aspect-ratio: 1;
  color: var(--lumiverse-primary);
  border: 7px solid;
  box-sizing: border-box;
  border-radius: 50%;
  background:
    radial-gradient(circle 3px, var(--lumiverse-primary-text) 95%,#0000),
    linear-gradient(180deg,var(--lumiverse-primary-text) 50%,#0000 0) center/3px 70%,
    linear-gradient(90deg ,var(--lumiverse-primary-text) 50%,#0000 0) center/50% 3px;
  background-repeat: no-repeat;
  position: relative;
  animation: la-ldk-8 1s infinite;
}
.la-ld-8:before, .la-ld-8:after {
  content: ""; position: absolute;
  border-radius: 20px 20px 0 0;
  inset: -20px calc(50% - 10px);
  transform: rotate(40deg);
  background:
    linear-gradient(currentColor 0 0) top   /100% 10px,
    linear-gradient(currentColor 0 0) bottom/3px  10px;
  background-repeat: no-repeat;
}
.la-ld-8:after { transform: rotate(-40deg); }
@keyframes la-ldk-8 {
  0%,70%,100% {transform: translateY(0)    rotate(0)}
  75%,85%,95% {transform: translateY(-3px) rotate(10deg)}
  80%,90%     {transform: translateY(-3px) rotate(-10deg)}
}

/* L9 — four bouncing dots */
.la-ld-9 {
  zoom: 0.30;
  width: 60px;
  aspect-ratio: 2;
  --_g: no-repeat radial-gradient(farthest-side,var(--lumiverse-primary) 90%,#0000);
  background:
    var(--_g) 0    50%,
    var(--_g) 50%  50%,
    var(--_g) 50%  50%,
    var(--_g) 100% 50%;
  background-size: 25% 50%;
  animation: la-ldk-9 1s infinite linear;
}
@keyframes la-ldk-9 {
  33%  {background-position:0   0  ,50% 100%,50%  100%,100% 0}
  66%  {background-position:50% 0  ,0   100%,100% 100%,50%  0}
  100% {background-position:50% 50%,0   50% ,100% 50% ,50%  50%}
}

/* L10 — twin spinning eyes */
.la-ld-10 {
  zoom: 0.55;
  display: inline-flex;
  gap: 10px;
}
.la-ld-10:before, .la-ld-10:after {
  content: "";
  height: 20px;
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(farthest-side,var(--lumiverse-primary-contrast) 95%,#0000) 35% 35%/6px 6px no-repeat
    var(--lumiverse-primary);
  transform: scaleX(var(--s,1)) rotate(0deg);
  animation: la-ldk-10 1s infinite linear;
}
.la-ld-10:after { --s: -1; animation-delay:-0.1s; }
@keyframes la-ldk-10 { 100% {transform:scaleX(var(--s,1)) rotate(360deg);} }

/* L11 — ball bouncing across bars */
.la-ld-11 {
  zoom: 0.40;
  width: 40px;
  height: 30px;
  --c:no-repeat linear-gradient(var(--lumiverse-primary) 0 0);
  background:
    var(--c) 0    100%/8px 30px,
    var(--c) 50%  100%/8px 20px,
    var(--c) 100% 100%/8px 10px;
  position: relative;
  clip-path: inset(-100% 0);
}
.la-ld-11:before {
  content: "";
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lumiverse-primary);
  left: -16px;
  top: 0;
  animation:
    la-ldk-11a 2s   linear infinite,
    la-ldk-11b 0.5s cubic-bezier(0,200,.8,200) infinite;
}
@keyframes la-ldk-11a {
  0%   {left:-16px;transform:translateY(-8px)}
  100% {left:calc(100% + 8px);transform:translateY(22px)}
}
@keyframes la-ldk-11b { 100% {top:-0.1px} }

/* L12 — counting numbers */
.la-ld-12 {
  zoom: 0.18;
  display: inline-flex;
  border: 10px solid var(--lumiverse-primary);
  border-radius: 5px;
}
.la-ld-12::before, .la-ld-12::after {
  content: "0 1 2 3 4 5 6 7 8 9 0";
  font-size: 30px;
  font-family: monospace;
  font-weight: bold;
  line-height: 1em;
  height: 1em;
  width: 1.2ch;
  text-align: center;
  outline:1px solid var(--lumiverse-primary);
  color: #0000;
  text-shadow:0 0 0 var(--lumiverse-primary);
  overflow: hidden;
  animation: la-ldk-12 2s infinite linear;
}
.la-ld-12::before { animation-duration: 4s; }
@keyframes la-ldk-12 { 100% {text-shadow:0 var(--t,-10em) 0 var(--lumiverse-primary)} }

/* L13 — gooey morphing dots */
.la-ld-13 {
  zoom: 0.22;
  width: 80px;
  aspect-ratio: 1;
  border: 10px solid #0000;
  box-sizing: border-box;
  background:
    radial-gradient(farthest-side,var(--lumiverse-primary) 98%,#0000) 0    0/20px 20px,
    radial-gradient(farthest-side,var(--lumiverse-primary) 98%,#0000) 100% 0/20px 20px,
    radial-gradient(farthest-side,var(--lumiverse-primary) 98%,#0000) 100% 100%/20px 20px,
    radial-gradient(farthest-side,var(--lumiverse-primary) 98%,#0000) 0 100%/20px 20px,
    linear-gradient(var(--lumiverse-primary) 0 0) 50%/40px 40px,
    var(--lumiverse-bg-deep);
  background-repeat:no-repeat;
  filter: blur(4px) contrast(10);
  animation: la-ldk-13 0.8s infinite;
}
@keyframes la-ldk-13 { 100%  {background-position:100% 0,100% 100%,0 100%,0 0,center} }

/* L14 — figure-eight */
.la-ld-14 {
  zoom: 0.30;
  width: 60px;
  height: 30px;
  display: flex;
  --c:#0000 calc(100% - 5px),var(--lumiverse-primary) calc(100% - 4px) 96%,#0000;
  background:
    radial-gradient(farthest-side at bottom,var(--c)) 0 0,
    radial-gradient(farthest-side at top   ,var(--c)) 100% 100%;
  background-size:calc(50% + 2px) 50%;
  background-repeat: no-repeat;
  animation: la-ldk-14 2s infinite linear;
}
.la-ld-14:before { content: ""; flex: 1; background: inherit; transform: rotate(90deg); }
@keyframes la-ldk-14 { 100% {transform:rotate(1turn)} }

/* L15 — quadrant tile swap */
.la-ld-15 {
  zoom: 0.25;
  width: 60px;
  aspect-ratio: 1;
  background:
    linear-gradient(45deg,var(--lumiverse-primary) 50%,#0000 0),
    linear-gradient(45deg,#0000 50%,var(--lumiverse-primary) 0),
    linear-gradient(-45deg,var(--lumiverse-primary-text) 50%,#0000 0),
    linear-gradient(-45deg,#0000 50%,var(--lumiverse-primary-text) 0),
    linear-gradient(var(--lumiverse-bg-deep) 0 0);
  background-size: 50% 50%;
  background-repeat: no-repeat;
  animation: la-ldk-15 1.5s infinite;
}
@keyframes la-ldk-15 {
  0%   {background-position:50% 50%,50% 50%,50%  50% ,50% 50%,50% 50%}
  25%  {background-position:0  100%,100%  0,50%  50% ,50% 50%,50% 50%}
  50%  {background-position:0  100%,100%  0,100% 100%,0   0  ,50% 50%}
  75%  {background-position:50% 50%,50% 50%,100% 100%,0   0  ,50% 50%}
  100% {background-position:50% 50%,50% 50%,50%  50% ,50% 50%,50% 50%}
}
`;
