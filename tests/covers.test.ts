import {expect,it} from 'vitest';
import {coverRatio,selectKuaishouCovers} from '../src/core/covers';
it('accepts only 4:3 and 3:4 cover dimensions',()=>{
 expect(coverRatio(1200,900)).toBe('4:3');expect(coverRatio(900,1200)).toBe('3:4');
 for(const [w,h] of [[1280,720],[1000,1000],[0,0],[Infinity,3]])expect(()=>coverRatio(w!,h!)).toThrow(/4:3/);
});
const items=[{id:'a',ratio:'4:3'},{id:'b',ratio:'4:3'},{id:'c',ratio:'3:4'},{id:'d',ratio:'3:4'}] as const;
it('selects one of each ratio when both are available',()=>{
 for(const random of [()=>0,()=>0.999]){const selected=selectKuaishouCovers([...items],random);expect(selected.map(c=>c.ratio)).toEqual(['4:3','3:4']);expect(new Set(selected.map(c=>c.id)).size).toBe(2);}
});
it('randomly selects two distinct covers of the available ratio',()=>{
 expect(selectKuaishouCovers([...items.slice(0,2)],()=>0).map(c=>c.id)).toEqual(['a','b']);
 expect(selectKuaishouCovers([...items.slice(0,2)],()=>0.999).map(c=>c.id)).toEqual(['b','a']);
 expect(selectKuaishouCovers([items[0]])).toEqual([items[0]]);expect(selectKuaishouCovers([])).toEqual([]);
});
