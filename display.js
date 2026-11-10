const ORIENTATIONS=new Set(['auto','portrait','landscape']);
export class DisplayMode{
  constructor({document,screen,onChange=()=>{},onMessage=()=>{},beforeChange=()=>{},onPreference=()=>{},preference='auto',standalone=false}){
    Object.assign(this,{document,screen,onChange,onMessage,beforeChange,onPreference,standalone});this.preference=ORIENTATIONS.has(preference)?preference:'auto';this.focus=false;this.locked=false;this.busy=false;this.operation=0;this.wasFullscreen=this.fullscreen;
    this.handleChange=()=>this.changed();document.addEventListener('fullscreenchange',this.handleChange);document.addEventListener('webkitfullscreenchange',this.handleChange);
  }
  get fullscreen(){return !!(this.document.fullscreenElement||this.document.webkitFullscreenElement);}
  get canFullscreen(){const d=this.document,r=d.documentElement;return !!((r.requestFullscreen&&d.fullscreenEnabled!==false)||(r.webkitRequestFullscreen&&d.webkitFullscreenEnabled!==false));}
  get state(){return {fullscreen:this.fullscreen,focus:this.focus,busy:this.busy,canFullscreen:this.canFullscreen,canLock:typeof this.screen?.orientation?.lock==='function',locked:this.locked,preference:this.preference,standalone:this.standalone};}
  notify(){this.onChange(this.state);}
  unlock(){try{this.screen?.orientation?.unlock?.();}catch{}this.locked=false;}
  changed(){
    const active=this.fullscreen;
    if(this.wasFullscreen&&!active){this.operation++;this.unlock();}
    if(active)this.focus=false;this.wasFullscreen=active;this.notify();
  }
  async enter(){
    if(!this.canFullscreen)return false;
    const d=this.document,root=d.documentElement;
    // Older WebKit returns void; its change event is the source of truth.
    let complete,timer;const changed=new Promise(resolve=>{complete=resolve;}),check=()=>{if(this.fullscreen)complete(true);},failed=()=>complete(false);
    for(const event of ['fullscreenchange','webkitfullscreenchange'])d.addEventListener(event,check);
    for(const event of ['fullscreenerror','webkitfullscreenerror'])d.addEventListener(event,failed);
    timer=setTimeout(()=>complete(this.fullscreen),1200);
    try{
      const request=root.requestFullscreen?root.requestFullscreen({navigationUI:'hide'}):root.webkitRequestFullscreen();
      if(request?.then)await request;
      return this.fullscreen||await changed;
    }catch{return false;}
    finally{clearTimeout(timer);for(const event of ['fullscreenchange','webkitfullscreenchange'])d.removeEventListener(event,check);for(const event of ['fullscreenerror','webkitfullscreenerror'])d.removeEventListener(event,failed);}
  }
  async toggle(){
    if(this.busy)return;this.beforeChange();this.busy=true;this.notify();
    try{
      if(this.fullscreen){this.unlock();const d=this.document;if(d.exitFullscreen)await d.exitFullscreen();else await d.webkitExitFullscreen();}
      else if(this.focus){this.focus=false;this.onMessage('Focus view closed.');}
      else if(!await this.enter()){
        this.focus=true;this.onMessage('Focus view enabled. Your browser keeps its address bar visible.');
      }
    }catch{this.onMessage('Use your browser’s fullscreen exit control to leave this view.');}
    finally{this.busy=false;this.changed();}
  }
  async orient(value){
    if(!ORIENTATIONS.has(value)||this.busy)return;
    this.beforeChange();this.preference=value;this.onPreference(value);this.unlock();const operation=++this.operation;
    if(value==='auto'){this.onMessage('Orientation follows your device.');this.notify();return;}
    this.busy=true;this.notify();
    try{
      if(typeof this.screen?.orientation?.lock!=='function'){this.onMessage(`Rotate your device to ${value}. This browser cannot lock its orientation.`);return;}
      // The fullscreen request starts in the original tap/keyboard event.
      if(!this.fullscreen&&!this.standalone&&this.canFullscreen)await this.enter();
      if(operation!==this.operation)return;
      await this.screen.orientation.lock(value);
      if(operation!==this.operation){this.unlock();return;}
      this.locked=true;this.onMessage(`${value==='portrait'?'Portrait':'Landscape'} orientation locked.`);
    }catch{this.locked=false;this.onMessage(`Rotate your device to ${value}. Orientation locking is unavailable here.`);}
    finally{this.busy=false;this.changed();}
  }
  destroy(){this.operation++;this.unlock();this.document.removeEventListener('fullscreenchange',this.handleChange);this.document.removeEventListener('webkitfullscreenchange',this.handleChange);}
}

export function viewportState({width,height,visualHeight=height,scale=1,coarse=false,orientationType='',legacyAngle,editing=false,previousOrientation=''}){
  let orientation=orientationType.startsWith('landscape')?'landscape':orientationType.startsWith('portrait')?'portrait':Number.isFinite(legacyAngle)?(Math.abs(legacyAngle)%180===90?'landscape':'portrait'):editing&&previousOrientation?previousOrientation:width>height?'landscape':'portrait';
  return {width,height:Math.max(180,Math.round(scale===1?Math.min(height,visualHeight):height)),orientation,compact:width<=900||(coarse&&width<=1200),touch:coarse};
}

export class ViewportUI{
  constructor({window,document,onRotate=()=>{},onCompact=()=>{}}){
    Object.assign(this,{window,document,onRotate,onCompact});this.last=null;this.pending=0;this.expanded=false;
    this.coarse=window.matchMedia('(pointer: coarse)');this.update=()=>{if(!this.pending)this.pending=window.requestAnimationFrame(()=>{this.pending=0;this.measure();});};
    window.addEventListener('resize',this.update);window.addEventListener('orientationchange',this.update);window.visualViewport?.addEventListener('resize',this.update);window.screen?.orientation?.addEventListener?.('change',this.update);this.coarse.addEventListener?.('change',this.update);
    this.measure();
  }
  measure(){
    const w=this.window,v=w.visualViewport,editing=/INPUT|TEXTAREA|SELECT/.test(this.document.activeElement?.tagName||'');
    const state=viewportState({width:w.innerWidth,height:w.innerHeight,visualHeight:v?.height??w.innerHeight,scale:v?.scale??1,coarse:this.coarse.matches,orientationType:this.coarse.matches?w.screen?.orientation?.type||'':'',legacyAngle:w.orientation,editing,previousOrientation:this.last?.orientation||''});
    const root=this.document.documentElement;root.style.setProperty('--view-height',state.height+'px');root.dataset.compact=String(state.compact);root.dataset.orientation=state.orientation;root.dataset.touch=String(state.touch);root.dataset.short=String(state.height<650);root.dataset.keyboard=String(editing&&state.height<430);
    if(this.last&&state.orientation!==this.last.orientation)this.onRotate();
    const changed=!this.last||state.compact!==this.last.compact;this.last=state;if(changed)this.onCompact(state.compact);this.syncSheet();
  }
  syncSheet(){
    const d=this.document,compact=this.last?.compact,open=!compact||this.expanded;
    d.getElementById('routeBrowser').hidden=!open;d.getElementById('routePicker').dataset.expanded=String(compact&&this.expanded);d.getElementById('browseBtn').setAttribute('aria-expanded',String(open));d.getElementById('browseLabel').textContent=this.expanded?'Done':'Change piste';
  }
  setExpanded(value){this.expanded=!!value;this.syncSheet();}
  selected(){if(this.last?.compact){this.document.getElementById('search').blur();this.setExpanded(false);this.document.getElementById('browseBtn').focus({preventScroll:true});}}
  bindSheet(){
    const button=this.document.getElementById('browseBtn');let start=null,suppress=0;
    button.addEventListener('click',event=>{if(event.detail!==0&&performance.now()<suppress)return;this.setExpanded(!this.expanded);if(this.expanded)this.document.querySelector('.route-option.active')?.focus({preventScroll:true});});
    button.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){start={id:e.pointerId,y:e.clientY};try{button.setPointerCapture(e.pointerId);}catch{}}});
    button.addEventListener('pointerup',e=>{if(start?.id===e.pointerId){const dy=e.clientY-start.y;if(Math.abs(dy)>32){this.setExpanded(dy<0);suppress=performance.now()+400;e.preventDefault();}start=null;}});
    button.addEventListener('pointercancel',()=>{start=null;});
  }
}
