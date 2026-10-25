import { describe, expect, it } from 'vitest';
import { CUE_TONES } from './synth';
import { DICE_CONTACT_MS } from '../dice-timing';
it('keeps fallback impact sounds on the six visible contacts',()=>{
  const impacts=CUE_TONES.dice.filter(t=>t.type==='triangle');
  expect(impacts).toHaveLength(6);
  impacts.forEach((tone,i)=>expect(tone.at*1000).toBeCloseTo(DICE_CONTACT_MS[i]!,8));
  for(let i=1;i<impacts.length;i++)expect(impacts[i]!.gain).toBeLessThan(impacts[i-1]!.gain);
});
