import {useEffect,useId,useRef,useState} from 'react';
import type {Task} from '../core/model';
import {taskProgress,type StepState} from '../core/task-progress';
const states:Record<StepState,string>={done:'已完成',active:'正在处理',pending:'待处理',stopped:'已停止',unknown:'未记录'};
const icons:Record<StepState,string>={done:'✓',active:'●',pending:'○',stopped:'!',unknown:'—'};
export function TaskProgress({task}:{task:Task}) {
 const {steps,current}=taskProgress(task);
 const id=useId();const anchor=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLDivElement>(null);
 const closeTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const wrapper=useRef<HTMLDivElement>(null);const [open,setOpen]=useState(false);const [pinned,setPinned]=useState(false);
 useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
 useEffect(()=>{
  const element=panel.current;if(!element)return;
  if(!open){if(element.matches(':popover-open'))element.hidePopover();return;}
  element.showPopover();
  const position=()=>{
   const rect=anchor.current?.getBoundingClientRect();if(!rect)return;
   const width=Math.min(380,window.innerWidth-24);
   const below=window.innerHeight-rect.bottom-12;const above=rect.top-12;
   const useBelow=below>=Math.min(380,above);
   const height=Math.min(420,window.innerHeight-24,Math.max(100,useBelow?below:above));
   element.style.width=width+'px';element.style.maxHeight=height+'px';
   element.style.left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12))+'px';
   const actualHeight=element.getBoundingClientRect().height;
   const preferredTop=useBelow?rect.bottom+6:rect.top-actualHeight-6;
   element.style.top=Math.max(12,Math.min(preferredTop,window.innerHeight-actualHeight-12))+'px';
   element.style.bottom='auto';
  };
  position();window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  const dismiss=(event:PointerEvent)=>{if(!wrapper.current?.contains(event.target as Node)){setOpen(false);setPinned(false);}};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);setPinned(false);}};
  document.addEventListener('keydown',escape);document.addEventListener('pointerdown',dismiss);
  return()=>{document.removeEventListener('keydown',escape);window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);document.removeEventListener('pointerdown',dismiss);};
 },[open]);
 return <div className="task-progress" ref={wrapper}
  onMouseEnter={()=>{clearTimeout(closeTimer.current);setOpen(true);}} onMouseLeave={()=>{if(!pinned&&!wrapper.current?.contains(document.activeElement))closeTimer.current=setTimeout(()=>setOpen(false),150);}}
  onFocusCapture={()=>{clearTimeout(closeTimer.current);setOpen(true);}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget)){setOpen(false);setPinned(false);}}}
  onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);setPinned(false);}}}>
  <button ref={anchor} type="button" className="progress-trigger" aria-expanded={open} aria-controls={id}
   onClick={()=>{setPinned(!pinned);setOpen(!pinned);}}>
   <span className={'step-icon '+current.state} aria-hidden="true">{icons[current.state]}</span>
   <span><span className="progress-caption">当前步骤</span><strong>{current.label}</strong></span>
   <span className={'step-state '+current.state}>{states[current.state]}</span><span aria-hidden="true">⌄</span>
  </button>
  <div id={id} ref={panel} popover="manual" className="progress-panel" role="region" aria-label="全部处理步骤" tabIndex={0}>
   <div className="progress-panel-heading"><strong>处理步骤</strong><span>{steps.filter(s=>s.state==='done').length}/{steps.length} 已完成</span></div>
   {current.state==='unknown'&&<p className="progress-note">旧版未保存具体步骤，无法还原执行位置。</p>}
   <ol>{steps.map(step=><li key={step.id} className={step.state} aria-current={step.id===current.id?'step':undefined}>
    <span className={'step-icon '+step.state} aria-hidden="true">{icons[step.state]}</span><span className="step-label">{step.label}</span><span className="step-state">{states[step.state]}</span>
   </li>)}</ol>
   <p className="progress-note">停在编辑页，由你检查；不会自动发布或存草稿。</p>
  </div>
 </div>;
}
