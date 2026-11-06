'use client';

import { motion } from 'framer-motion';

const scanPoints = [
  [124, 52], [177, 77], [211, 108], [92, 127], [146, 150], [193, 167],
  [57, 94], [235, 143], [114, 198], [168, 213], [73, 174], [218, 73],
];

export default function WorldScanAnimation({ active = false }: { active?: boolean }) {
  return <div className={`world-scan ${active ? 'world-scan-active' : ''}`} aria-label={active ? 'Analyse des sites publics dans le monde' : 'Recherche sur le web public mondial'} role="img">
    <div className="world-scan-halo world-scan-halo-one"/><div className="world-scan-halo world-scan-halo-two"/>
    <svg className="world-globe" viewBox="0 0 280 280" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="globeFill" cx="0" cy="0" r="1" gradientTransform="translate(92 72) rotate(48) scale(235)"><stop stopColor="#2865d9" stopOpacity=".3"/><stop offset="1" stopColor="#14264b" stopOpacity=".08"/></radialGradient>
        <clipPath id="globeClip"><circle cx="140" cy="140" r="103"/></clipPath>
      </defs>
      <circle cx="140" cy="140" r="104" fill="url(#globeFill)" stroke="rgba(111,156,255,65)"/>
      <g clipPath="url(#globeClip)" stroke="rgba(127,164,239,31)" strokeWidth=".8">
        <ellipse cx="140" cy="140" rx="45" ry="103"/><ellipse cx="140" cy="140" rx="83" ry="103"/>
        <ellipse cx="140" cy="140" rx="103" ry="29"/><ellipse cx="140" cy="140" rx="103" ry="65"/>
        <path d="M37 140h206M140 37v206"/>
        <path d="M51 91c31 20 61 28 89 28s58-8 89-28M51 189c31-20 61-28 89-28s58 8 89 28"/>
        <path d="M68 72c12 13 22 19 35 21 13 2 19-11 30-7 8 3 11 15 20 17 12 3 17-10 31-7 12 2 19 12 31 19M54 146c22-8 29-20 45-19 14 1 16 13 30 14 17 1 19-13 35-12 17 1 27 17 52 14M62 176c19-7 35-5 45 7 10 11 12 20 26 23 12 2 21-7 34-7 13 0 22 8 38 5"/>
      </g>
      <motion.path d="M140 36a104 104 0 0 1 0 208" stroke="#5c9ee0" strokeWidth="1.4" strokeDasharray="5 8" opacity=".8" animate={{pathLength:[0,.9,0],opacity:[.15,.9,.15]}} transition={{duration:3.2,repeat:Infinity,ease:'easeInOut'}}/>
      {scanPoints.map(([cx,cy],i)=><motion.g key={`${cx}-${cy}`} animate={active ? {opacity:[.25,1,.35],scale:[.8,1.25,.85]} : {opacity:[.3,.8,.3],scale:[.8,1,.8]}} transition={{duration:1.7+(i%4)*.35,delay:(i%6)*.24,repeat:Infinity,ease:'easeInOut'}} style={{transformOrigin:`${cx}px ${cy}px`}}>
        <circle cx={cx} cy={cy} r="6" fill="#5197dd" opacity=".13"/><circle cx={cx} cy={cy} r="2.1" fill="#70b0f0"/>
      </motion.g>)}
      <motion.circle cx="140" cy="140" r="103" stroke="#599cdf" strokeWidth="2" strokeDasharray="30 620" animate={{rotate:360}} transition={{duration:5,repeat:Infinity,ease:'linear'}} style={{transformOrigin:'140px 140px'}}/>
    </svg>
    <div className="world-scan-core"><span className="world-core-pulse"/><span className="world-core-dot"/></div>
    <div className="world-map-label label-america">AMÉRIQUE DU NORD <i/></div><div className="world-map-label label-europe">EUROPE <i/></div><div className="world-map-label label-asia">ASIE-PACIFIQUE <i/></div>
    <div className="world-scan-caption"><span className="world-live-dot"/>{active ? 'ANALYSE DES SOURCES PUBLIQUES' : 'PRÊT À ANALYSER LE WEB PUBLIC'}</div>
  </div>;
}
