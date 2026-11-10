export class TouchInput{
  constructor({buttons,document,window,enabled=()=>true}){
    this.buttons=[...buttons];this.document=document;this.enabled=enabled;this.pointers=new Map();this.listeners=[];
    const listen=(element,event,handler)=>{element.addEventListener(event,handler,{passive:false});this.listeners.push(()=>element.removeEventListener(event,handler));};
    for(const button of this.buttons){
      listen(button,'pointerdown',event=>{
        if(!this.enabled()||event.button>0)return;event.preventDefault();
        this.pointers.set(event.pointerId,{key:button.dataset.key,group:button.closest('[data-touch-group]')});try{button.setPointerCapture(event.pointerId);}catch{}this.refresh();
      });
      listen(button,'pointermove',event=>{
        const p=this.pointers.get(event.pointerId);if(!p)return;
        const rect=p.group?.getBoundingClientRect?.();if(rect&&(p.key==='arrowleft'||p.key==='arrowright'||p.steer!==undefined)){const axis=Math.max(-1,Math.min(1,(event.clientX-rect.left-rect.width/2)/(rect.width*.44)));p.steer=Math.abs(axis)<.08?0:axis;p.key=p.steer<0?'arrowleft':p.steer>0?'arrowright':'';this.refresh();return;}
        const next=this.document.elementFromPoint?.(event.clientX,event.clientY)?.closest?.('[data-key]');
        if(next&&next.closest('[data-touch-group]')===p.group&&this.buttons.includes(next)){p.key=next.dataset.key;this.refresh();}
      });
      const release=event=>{if(this.pointers.delete(event.pointerId))this.refresh();};
      for(const name of ['pointerup','pointercancel','lostpointercapture'])listen(button,name,release);
      listen(button,'contextmenu',event=>event.preventDefault());
    }
    listen(window,'pointerup',event=>{if(this.pointers.delete(event.pointerId))this.refresh();});
    listen(window,'pointercancel',event=>{if(this.pointers.delete(event.pointerId))this.refresh();});
  }
  get steer(){let axis=0;for(const p of this.pointers.values())axis+=p.steer??(p.key==='arrowleft'?-1:p.key==='arrowright'?1:0);return Math.max(-1,Math.min(1,axis));}
  has(key){for(const p of this.pointers.values())if(p.key===key)return true;return false;}
  refresh(){for(const button of this.buttons){const held=this.has(button.dataset.key);button.classList.toggle('is-held',held);button.setAttribute('aria-pressed',String(held));}}
  clear(){this.pointers.clear();this.refresh();}
  destroy(){this.clear();for(const remove of this.listeners)remove();}
}
