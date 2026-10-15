// Shared by the inline artwork and the dependency-free site-icon generator.
export const OPEN_BOX = ['.....d...d.....','....dfffffd....','....defffed....','FF..dffnffd..FF','.FFoiiiiiiioFF.','..ooooooooooo..','..oBBBBTBBBDo..','..oBBBBBBBBDo..','..oBwwwwwBBDo..','..oBwwwwwBBDo..','..oBBBBBBBBDo..','..ooooooooooo..']
export const BOX = ['.ooooooooo.','oLLLLTLLLLo','ooooooooooo','oBBBBTBBBDo','oBBBBBBBBDo','oBwwwwwBBDo','oBwwwwwBBDo','oBBBBBBBBDo','oBBBBBBBBDo','ooooooooooo']
export const HOUSE = ['......r......','.....rrr.....','....rrrrr....','...rrrrrrr...','..rrrrrrrrr..','.rrrrrrrrrrr.','RRRRRRRRRRRRR','.wwwwwwwwwww.','.wkkwwwwwkkw.','.wkkwDDwwkkw.','.wwwwDDwwwww.','.wwwwDDwwwww.']
export const TREE = ['..ggg..','.ggGgg.','gggggGg','gGggggg','.ggggg.','...t...','...t...']
export const WALK = ['.d......d..d','d.......dfff','d.......ffef','.d.fffffffff','..ffffffffff','..ffffffff..','..f.....f...','..d......d..']
export const LOAF = ['.d...d.','dfffffd','defffed','dffnffd','ddddddd']
export const FURS = [{f:'#f0a050',d:'#c8702c'},{f:'#9aa0aa',d:'#6c727c'},{f:'#3b363e',d:'#24202a'},{f:'#f4ede2',d:'#c9bba6'},{f:'#d8b88c',d:'#a8865c'},{f:'#e6d3b6',d:'#7a5440'}]
export const ROOFS = ['#c8573e','#5b7fb8','#7a4f8f','#4f8a5b','#b8743d','#d9677a']
export const WALLS = ['#f4d6a0','#cfe3c0','#f2c4c4','#c9d8ef','#efe0f5','#f7e7b0']
export const AVATAR_COLORS = ['#a8432e','#3f5f94','#5e3a70','#3a6b45','#8c5427','#a8445a']
export const MARK_COLORS = {f:'#f0a050',d:'#c8702c',e:'#2a1b22',n:'#f08a9c',o:'#6b4426',F:'#b5733c',i:'#4a2e1c',B:'#d99a5b',D:'#b5733c',w:'#fbf3e6',T:'#b5733c'}
export function artHash(value: string) {
  let hash = 2166136261
  for (const char of value) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash,16777619) }
  return hash >>> 0
}
