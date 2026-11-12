import {expect,it} from 'vitest';
import {isDouyinUploadTransition} from '../src/core/platform-navigation';
import {normalizeDouyinPublication} from '../src/core/publication';
it('allows only the exact same-document Douyin upload-to-editor transition',()=>{
 const from='https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web';
 const to='https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page';
 expect(isDouyinUploadTransition(from,to,true)).toBe(true);
 expect(isDouyinUploadTransition(from,to.replace('/post/video','/publish'),true)).toBe(true);
 expect(isDouyinUploadTransition(from,to,false)).toBe(false);
 expect(isDouyinUploadTransition(from,to.replace('creator.douyin.com','evil.example'),true)).toBe(false);
 expect(isDouyinUploadTransition(to,to,true)).toBe(false);
 expect(isDouyinUploadTransition(from,to+'&other=1',true)).toBe(false);
});
it('validates Douyin title and body limits without applying Xiaohongshu title limits',()=>{
 expect(normalizeDouyinPublication({title:'字'.repeat(30)}).title).toHaveLength(30);
 expect(()=>normalizeDouyinPublication({title:'字'.repeat(31)})).toThrow(/30/);
 expect(()=>normalizeDouyinPublication({description:'字'.repeat(1000),tags:['话题']})).toThrow(/1000/);
});
