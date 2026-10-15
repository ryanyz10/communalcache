import { useEffect, useRef, type CSSProperties } from 'react'
import { CacheLink } from './CacheLink'
import { bindWalker } from '../lib/motion'
import { artHash, BOX, FURS, HOUSE, LOAF, MARK_COLORS, OPEN_BOX, ROOFS, TREE, WALK, WALLS } from '../lib/pixelArt'

type Colors = Record<string,string>
export function Pixels({ rows, colors, px = 2 }: { rows: string[]; colors: Colors; px?: number }) {
  return <g shapeRendering="crispEdges">{rows.flatMap((row,y)=>Array.from(row,(char,x)=>colors[char] ? <rect key={`${x}-${y}`} x={x*px} y={y*px} width={px} height={px} fill={colors[char]} /> : null))}</g>
}
export function BoxMark({ px = 2 }: { px?: number }) {
  return <svg aria-hidden="true" focusable="false" width={15*px} height={12*px} viewBox="0 0 30 24" shapeRendering="crispEdges"><Pixels rows={OPEN_BOX} colors={{...MARK_COLORS,o:'var(--cc-box-line)',F:'var(--cc-box-dark)',B:'var(--cc-box)',D:'var(--cc-box-dark)',T:'var(--cc-box-dark)'}} /></svg>
}
const boxColors = {o:'var(--cc-box-line)',L:'var(--cc-box-dark)',B:'var(--cc-box)',D:'var(--cc-box-dark)',w:'var(--cc-label)',T:'var(--cc-label)'}
function LoafCat({ fur, seed }: { fur: Colors; seed: number }) {
  const colors = {...fur,e:'#2a1b22',n:'#f08a9c'}
  return <g className="cc-loaf-cat" style={{'--cc-idle-delay':`${-(seed%11)}s`} as CSSProperties}>
    <g className="cc-cat-ears"><Pixels rows={LOAF.slice(0,1)} colors={colors} /></g>
    <g transform="translate(0 2)"><Pixels rows={LOAF.slice(1)} colors={colors} /></g>
    <g className="cc-cat-blink" fill={fur.f}><rect x="2" y="4" width="2" height="2" /><rect x="10" y="4" width="2" height="2" /></g>
  </g>
}

function CacheDrawing({ name, loaf = true, coat }: { name: string; loaf?: boolean; coat?: Colors }) {
  const seed = artHash(name), fur = coat ?? FURS[seed%FURS.length]
  return <g className="cc-cache-art">
    <g className="cc-cache-closed">
      <g transform="translate(4 10)"><g className="cc-box-lid"><Pixels rows={BOX.slice(0,2)} colors={boxColors} /></g><g transform="translate(0 4)"><Pixels rows={BOX.slice(2)} colors={boxColors} /></g></g>
      {loaf && <g transform="translate(8 0)"><LoafCat fur={fur} seed={seed} /></g>}
    </g>
    <g className="cc-cache-open"><g transform="translate(0 6)"><Pixels rows={OPEN_BOX} colors={{...MARK_COLORS,...boxColors,...fur,F:'var(--cc-box-dark)',T:'var(--cc-box-dark)',i:'#4a2e1c'}} /></g></g>
  </g>
}

export function CacheBox({ name }: { name: string }) {
  return <svg aria-hidden="true" focusable="false" width="30" height="30" viewBox="0 0 30 30" shapeRendering="crispEdges"><CacheDrawing name={name} /></svg>
}

function WalkingCat({ seed }: { seed: number }) {
  const cat = useRef<SVGSVGElement>(null)
  useEffect(() => { if (cat.current && typeof matchMedia === 'function') return bindWalker(cat.current) }, [])
  const colors = {...FURS[seed%FURS.length],e:'#2a1b22',n:'#f08a9c'}
  return <svg ref={cat} className="cc-walking-cat" width="24" height="18" viewBox="0 0 24 18" focusable="false" data-walking="false">
    <Pixels rows={WALK.slice(0,6)} colors={colors} />
    <g transform="translate(0 12)"><g className="cc-walk-a"><Pixels rows={WALK.slice(6)} colors={colors} /></g><g className="cc-walk-b"><Pixels rows={['...f...f....','...d...d....']} colors={colors} /></g></g>
  </svg>
}

type HorizonProps = { kind: 'boxes'|'houses'; entries: {id:string;name:string;to?:string}[]; tall?: boolean }
export function PixelHorizon({ kind, entries, tall = false }: HorizonProps) {
  return <div className="cc-horizon" aria-hidden="true">
    <HorizonScene kind={kind} entries={entries} />
    <HorizonScene kind={kind} entries={entries} tall={tall} desktop />
    <WalkingCat seed={entries.length} />
  </div>
}

function HorizonScene({ kind, entries, tall = false, desktop = false }: HorizonProps & { desktop?: boolean }) {
  const width = Math.max(440, entries.length * 40)
  return <svg className={desktop ? 'cc-horizon-desktop' : 'cc-horizon-phone'} width="100%" height="96" viewBox={desktop ? `0 ${tall ? -100 : 0} ${width} ${tall ? 196 : 96}` : undefined} style={{minWidth:desktop ? tall ? 0 : width*2 : Math.max(280,entries.length*40)}} focusable="false" data-horizon={kind}>
      {desktop && tall && <g><rect className="cc-sky-sun" x={width-64} y="-55" width="18" height="18" fill="var(--cc-sun)" /><path className="cc-sky-clouds" d="M28-24h24v6H28zM40-30h10v6H40zM160-50h28v6h-28zM168-56h12v6h-12z" fill="var(--cc-cloud)" /></g>}
      {Array.from({length:24},(_,index)=><svg key={index} x={`${index*100/24}%`} y={68-(index%3)*4} width="5%" height="28" overflow="visible"><rect width="100%" height="28" fill={index%2?'var(--cc-hill)':'var(--cc-hill2)'} /></svg>)}
      {[0,1,2].map(index=><svg key={index} x={`${(index+0.5)*100/3}%`} y="69" width="16" height="16" overflow="visible"><Pixels rows={TREE} colors={{g:'var(--cc-hill2)',G:'var(--cc-grass-dark)',t:'#6b4a2f'}} /></svg>)}
      <path d="M0 86h10000v10H0z" fill="var(--cc-grass)" /><path d="M0 86h10000v2H0z" fill="var(--cc-grass-dark)" />
      {entries.map((entry,index)=>{
        const hash=artHash(entry.name), fur=FURS[(hash>>>7)%FURS.length]
        const art=kind==='boxes' ? <g transform="translate(-4 -10)"><CacheDrawing name={entry.name} loaf={hash%2===0} coat={fur} /></g> : <><Pixels rows={HOUSE} colors={{r:ROOFS[hash%ROOFS.length],R:'var(--cc-box-line)',w:WALLS[(hash>>>3)%WALLS.length],k:'var(--cc-glass)',D:ROOFS[(hash>>>5)%ROOFS.length]}} />{hash%3===0 && <g transform="translate(28 14)"><LoafCat fur={fur} seed={hash} /></g>}</>
        return <svg key={entry.id} x={`${(index+1)*100/(entries.length+1)}%`} y={kind==='boxes'?68:64} width="30" height="28" overflow="visible"><g transform="translate(-13 0)">
          {entry.to ? <CacheLink to={entry.to} tabIndex={-1}><rect x="-8" y="-16" width="44" height="44" fill="transparent" />{art}</CacheLink> : art}
        </g></svg>
      })}
    </svg>
}
