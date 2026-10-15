import { Link } from 'react-router'
import { artHash, BOX, FURS, HOUSE, LOAF, MARK_COLORS, OPEN_BOX, ROOFS, TREE, WALK, WALLS } from '../lib/pixelArt'

type Colors = Record<string,string>
export function Pixels({ rows, colors, px = 2 }: { rows: string[]; colors: Colors; px?: number }) {
  return <g shapeRendering="crispEdges">{rows.flatMap((row,y)=>Array.from(row,(char,x)=>colors[char] ? <rect key={`${x}-${y}`} x={x*px} y={y*px} width={px} height={px} fill={colors[char]} /> : null))}</g>
}
export function BoxMark({ px = 2 }: { px?: number }) {
  return <svg aria-hidden="true" focusable="false" width={15*px} height={12*px} viewBox="0 0 30 24" shapeRendering="crispEdges"><Pixels rows={OPEN_BOX} colors={{...MARK_COLORS,o:'var(--cc-box-line)',F:'var(--cc-box-dark)',B:'var(--cc-box)',D:'var(--cc-box-dark)',T:'var(--cc-box-dark)'}} /></svg>
}
const boxColors = {o:'var(--cc-box-line)',L:'var(--cc-box-dark)',B:'var(--cc-box)',D:'var(--cc-box-dark)',w:'var(--cc-label)',T:'var(--cc-label)'}
export function CacheBox({ name }: { name: string }) {
  const fur = FURS[artHash(name)%FURS.length]
  return <svg aria-hidden="true" focusable="false" width="30" height="30" viewBox="0 0 30 30" shapeRendering="crispEdges"><g transform="translate(4 10)"><Pixels rows={BOX} colors={boxColors} /></g><g transform="translate(8 0)"><Pixels rows={LOAF} colors={{...fur,e:'#2a1b22',n:'#f08a9c'}} /></g></svg>
}

export function PixelHorizon({ kind, entries }: { kind: 'boxes'|'houses'; entries: {id:string;name:string;to?:string}[] }) {
  return <div className="cc-horizon" aria-hidden="true">
    <svg width="100%" height="96" style={{minWidth:Math.max(280,entries.length*40)}} focusable="false" data-horizon={kind}>
      {Array.from({length:24},(_,index)=><svg key={index} x={`${index*100/24}%`} y={68-(index%3)*4} width="5%" height="28" overflow="visible"><rect width="100%" height="28" fill={index%2?'var(--cc-hill)':'var(--cc-hill2)'} /></svg>)}
      {[0,1,2].map(index=><svg key={index} x={`${(index+0.5)*100/3}%`} y="69" width="16" height="16" overflow="visible"><Pixels rows={TREE} colors={{g:'var(--cc-hill2)',G:'var(--cc-grass-dark)',t:'#6b4a2f'}} /></svg>)}
      <path d="M0 86h10000v10H0z" fill="var(--cc-grass)" /><path d="M0 86h10000v2H0z" fill="var(--cc-grass-dark)" />
      {entries.map((entry,index)=>{
        const hash=artHash(entry.name), fur=FURS[(hash>>>7)%FURS.length]
        const art=kind==='boxes' ? <><Pixels rows={BOX} colors={boxColors} />{hash%2===0 && <g transform="translate(4 -10)"><Pixels rows={LOAF} colors={{...fur,e:'#2a1b22',n:'#f08a9c'}} /></g>}</> : <><Pixels rows={HOUSE} colors={{r:ROOFS[hash%ROOFS.length],R:'var(--cc-box-line)',w:WALLS[(hash>>>3)%WALLS.length],k:'var(--cc-glass)',D:ROOFS[(hash>>>5)%ROOFS.length]}} />{hash%3===0 && <g transform="translate(28 14)"><Pixels rows={LOAF} colors={{...fur,e:'#2a1b22',n:'#f08a9c'}} /></g>}</>
        return <svg key={entry.id} x={`${(index+1)*100/(entries.length+1)}%`} y={kind==='boxes'?68:64} width="30" height="28" overflow="visible"><g transform="translate(-13 0)">
          {entry.to ? <Link to={entry.to} tabIndex={-1}><rect x="-8" y="-16" width="44" height="44" fill="transparent" />{art}</Link> : art}
        </g></svg>
      })}
      <svg className="cc-walking-cat" y="74" width="24" height="18" overflow="visible"><Pixels rows={WALK} colors={{...FURS[entries.length%FURS.length],e:'#2a1b22',n:'#f08a9c'}} /></svg>
    </svg>
  </div>
}
