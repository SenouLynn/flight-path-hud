import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createParameterRouter } from './parameterRouter.js'
import { createParameterWriteRouter } from './parameterWriteRouter.js'
import { readRecording } from './recording.js'

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test-fixtures/mixed-sitl-parameter-write-v2.jsonl')

function fold() {
  const reads=createParameterRouter({send:()=>assert.fail('replay emitted a read'),canSend:()=>false,isLive:()=>false})
  const writes=createParameterWriteRouter({send:()=>assert.fail('replay emitted a write'),canSend:()=>false,isLive:()=>false})
  for(const entry of readRecording(fixture)){assert.equal(entry.data,null);reads.ingestRecordedEvent(entry.event);writes.ingestRecordedEvent(entry.event)}
  return {readFrames:reads.snapshotForNewClient(),writeFrames:writes.snapshotForNewClient()}
}

test('real-SITL fixture proves isolated writes, read-back, and restoration',()=>{
  const {readFrames,writeFrames}=fold();assert.ok(writeFrames.length>=6)
  assert.ok(writeFrames.every(frame=>frame.status==='complete'&&frame.name==='LOG_DISARMED'))
  for(const sysId of [1,2]){const targetWrites=writeFrames.filter(frame=>frame.sysId===sysId).map(frame=>frame.observedValue)
    assert.ok(targetWrites.includes(1));assert.equal(targetWrites.at(-1),0)
    const targetReads=readFrames.filter(frame=>frame.sysId===sysId);assert.ok(targetReads.some(frame=>frame.value?.value===1));assert.equal(targetReads.at(-1).value.value,0)}
})

test('parameter lifecycle replay is deterministic and passive',()=>{assert.deepEqual(fold(),fold())})
