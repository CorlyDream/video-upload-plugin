import {useEffect,useId,useRef,useState} from 'react';
import type {Task} from '../core/model';
import {taskProgress,type StepState} from '../core/task-progress';
const states:Record<StepState,string>={done:'已完成',active:'正在处理',pending:'待处理',stopped:'已停止',unknown:'未记录'};
const icons:Record<StepState,string>={done:'✓',active:'●',pending:'○',stopped:'!',unknown:'—'};
export function TaskProgress({task}:{task:Task}) {
 const {steps,current}=taskProgress(task);
 const doneCount=steps.filter(step=>step.state==='done').length;
 const handedOff=current.id==='review'&&current.state==='done';
 const stepCount=handedOff?steps.filter(step=>step.state!=='unknown').length:steps.length;
 const id=useId();
 const wrapper=useRef<HTMLDivElement>(null);
 const closeTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const [open,setOpen]=useState(false);const [pinned,setPinned]=useState(false);
 const closeSoon=()=>{if(pinned||wrapper.current?.contains(document.activeElement))return;clearTimeout(closeTimer.current);closeTimer.current=setTimeout(()=>setOpen(false),160);};
 const keepOpen=()=>{clearTimeout(closeTimer.current);setOpen(true);};
 const toggle=()=>{clearTimeout(closeTimer.current);if(open&&pinned){setPinned(false);setOpen(false);return;}setPinned(true);setOpen(true);};
 useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
 useEffect(()=>{
  if(!open||!pinned)return;
  const dismiss=(event:PointerEvent)=>{if(!wrapper.current?.contains(event.target as Node)){setOpen(false);setPinned(false);}};
  document.addEventListener('pointerdown',dismiss);
  return()=>document.removeEventListener('pointerdown',dismiss);
 },[open,pinned]);
 return <div className="task-progress" ref={wrapper}
  onFocusCapture={keepOpen}
  onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget)&&!pinned)setOpen(false);}}
  onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);setPinned(false);}}}>
  <div className={handedOff?'progress-summary done':'progress-summary'}>
   <span className={'step-icon '+current.state} aria-hidden="true">{icons[current.state]}</span>
   <span className="progress-summary-copy"><span className="progress-caption">{handedOff?'插件进度':'当前步骤'} · {doneCount}/{stepCount} 已完成</span><strong>{current.label}</strong></span>
   <span className={'step-state '+current.state}>{states[current.state]}</span>
   <progress className="progress-meter" max={stepCount} value={doneCount} aria-label={`处理进度：${doneCount}/${stepCount} 已完成`} />
  </div>
  <button type="button" className="progress-trigger" aria-expanded={open} aria-controls={id}
   aria-label={open?'收起处理步骤':`查看全部处理步骤，已完成 ${doneCount}/${stepCount}`}
   onMouseEnter={keepOpen} onMouseLeave={closeSoon} onClick={toggle}>
   <span>{open?'收起步骤':'查看步骤'}</span><span aria-hidden="true">{open?'⌃':'⌄'}</span>
  </button>
  {open&&<div id={id} className="progress-panel" role="region" aria-label="全部处理步骤" tabIndex={0} onMouseEnter={keepOpen} onMouseLeave={closeSoon}>
   <div className="progress-panel-heading"><strong>处理步骤</strong><span>{stepCount!==steps.length?'已记录步骤 · ':''}{doneCount}/{stepCount} 已完成</span></div>
   {current.state==='unknown'&&<p className="progress-note">旧版未保存具体步骤，无法还原执行位置。</p>}
   <ol>{steps.map(step=><li key={step.id} className={step.state} aria-current={step.id===current.id?'step':undefined}>
    <span className={'step-icon '+step.state} aria-hidden="true">{icons[step.state]}</span><span className="step-label">{step.label}</span><span className="step-state">{states[step.state]}</span>
   </li>)}</ol>
   <p className="progress-note">{task.platform==='bilibili'?'保存到草稿箱后由你检查；不会自动投稿。':'停在编辑页，由你检查；不会自动发布或存草稿。'}</p>
  </div>}
 </div>;
}
