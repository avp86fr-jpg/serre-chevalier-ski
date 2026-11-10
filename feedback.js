import {clamp} from './core.js';
// Presentation signals only: metres, timing, controls and saved runs stay in the simulation.
export function rideFeedback(run,input,time,strength=.35){
 const motion=clamp(Number.isFinite(strength)?strength:0,0,1),speed=clamp(run.speed/32,0,1),edge=clamp(Math.abs(run.edgeAngle)/.48,0,1),soft=clamp(run.softSnow||0,0,1),brake=input.brake?1:0;
 return {roll:clamp(-run.edgeAngle*.026*motion,-.014,.014),bob:motion*speed*(.006+soft*.014+brake*.008)*Math.sin(time*(brake?23:17)),shake:motion*speed*speed*(.01+soft*.012)*((time*41)%1>.5?1:-1),lean:run.edgeAngle*.44,flex:clamp((input.tuck&&run.speed>4?.17:0)+brake*.06+edge*.025,0,.22),windGain:.009+speed*speed*.075,skiGain:clamp(speed*(.012+edge*.055+brake*.09+soft*.035),0,.18),skiFrequency:380+speed*1450+edge*650-brake*180};
}
