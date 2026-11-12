export type CoverRatio = '4:3' | '3:4';
export function coverRatio(width:number,height:number):CoverRatio {
  if(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0){
    if(width*3===height*4)return '4:3';
    if(width*4===height*3)return '3:4';
  }
  throw new Error('封面只支持 4:3 或 3:4 比例，请更换图片');
}
export async function inspectCover(blob:Blob):Promise<CoverRatio>{
  let image:ImageBitmap;
  try{image=await createImageBitmap(blob);}catch{throw new Error('无法读取封面图片，请选择有效的 4:3 或 3:4 图片');}
  try{return coverRatio(image.width,image.height);}finally{image.close();}
}
/** Select without replacement. Persist the chosen IDs on the task, never reroll on retry. */
export function selectKuaishouCovers<T extends {ratio:CoverRatio}>(covers:T[], random= Math.random):T[]{
  const landscape=covers.filter(c=>c.ratio==='4:3'),portrait=covers.filter(c=>c.ratio==='3:4');
  const take=(pool:T[])=>pool.splice(Math.min(pool.length-1,Math.floor(random()*pool.length)),1)[0]!;
  if(landscape.length&&portrait.length)return [take(landscape),take(portrait)];
  const pool=[...covers];return Array.from({length:Math.min(2,pool.length)},()=>take(pool));
}
