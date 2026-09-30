// Adapted from Moss & Maw (garbage-dragon/src/touch-stick.ts): a floating stick on the left half of the screen.
interface StickOptions {
  // Movement can begin on the left half of this surface, centered under the thumb.
  floatingSurface?:HTMLElement;
  responseExponent?:number;
}

// Each stick owns one pointer; a second finger cannot steal or release it.
export class TouchStick {
  x=0;
  y=0;
  private pointer:number|null=null;
  private capture:HTMLElement|null=null;
  private origin={x:0,y:0};
  private travel=1;
  constructor(private root:HTMLElement,private enabled:()=>boolean,private options:StickOptions={}) {
    const listen=(surface:HTMLElement,isPlayfield=false)=>{
      surface.addEventListener('pointerdown',event=>{
        if(!enabled()||this.pointer!==null||event.button!==0)return;
        if(isPlayfield&&(event.pointerType!=='touch'||event.clientX>=window.innerWidth/2))return;
        event.preventDefault();
        const rect=root.getBoundingClientRect(),center={x:rect.left+rect.width/2,y:rect.top+rect.height/2};
        if(rect.width===0)return; // No touch pad on a mouse-only layout.
        this.travel=rect.width*.3;
        this.origin=options.floatingSurface?{x:event.clientX,y:event.clientY}:center;
        if(options.floatingSurface){
          root.style.transform=`translate(${this.origin.x-center.x}px,${this.origin.y-center.y}px)`;
          root.classList.add('floating');
        }
        this.pointer=event.pointerId;this.capture=surface;
        surface.setPointerCapture(event.pointerId);this.move(event);
      });
      surface.addEventListener('pointermove',event=>this.move(event));
      for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,event=>{
        if((event as PointerEvent).pointerId===this.pointer)this.reset();
      });
    };
    listen(root);
    if(options.floatingSurface)listen(options.floatingSurface,true);
  }
  private move(event:PointerEvent) {
    if(event.pointerId!==this.pointer||!this.enabled())return;
    event.preventDefault();
    const dx=(event.clientX-this.origin.x)/this.travel,dy=(event.clientY-this.origin.y)/this.travel;
    const length=Math.hypot(dx,dy),deflection=Math.max(0,(Math.min(length,1)-.12)/.88);
    // More thumb travel for precision at low speed; full travel still supplies full drive.
    const amount=deflection**(this.options.responseExponent??1);
    this.x=length?dx/length*amount:0;this.y=length?dy/length*amount:0;
    const visible=Math.min(length,1);
    this.root.style.setProperty('--stick-x',`${length?dx/length*visible*this.travel:0}px`);
    this.root.style.setProperty('--stick-y',`${length?dy/length*visible*this.travel:0}px`);
    this.root.classList.toggle('held',amount>0);
  }
  reset() {
    const pointer=this.pointer,capture=this.capture;this.pointer=null;this.capture=null;this.x=this.y=0;
    if(pointer!==null&&capture?.hasPointerCapture(pointer))capture.releasePointerCapture(pointer);
    this.root.style.removeProperty('--stick-x');this.root.style.removeProperty('--stick-y');this.root.style.removeProperty('transform');
    this.root.classList.remove('held','floating');
  }
}
