export function isDouyinUploadTransition(from:string,to:string,sameDocument:boolean):boolean{
  if(!sameDocument)return false;
  try{
    const a=new URL(from),b=new URL(to);
    return a.origin==='https://creator.douyin.com'&&b.origin===a.origin&&a.pathname==='/creator-micro/content/upload'&&['/creator-micro/content/post/video','/creator-micro/content/publish'].includes(b.pathname)&&b.search==='?enter_from=publish_page'&&!b.hash;
  }catch{return false;}
}
