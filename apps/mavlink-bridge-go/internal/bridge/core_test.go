package bridge

import (
	"encoding/json"
	"testing"
)

func heartbeat(sequence int) []byte {
	value := map[string]any{"recvTimestampMs": 1000, "sysId": 1, "compId": 1, "messageName": "HEARTBEAT", "sequence": sequence, "payload": map[string]any{"timestampMs": 1000, "heartbeat": map[string]any{"customMode": 0, "vehicleType": 2, "autopilotType": 3, "baseMode": 0, "armed": false, "systemStatus": 4, "mavlinkVersion": 3}}}
	data, _ := json.Marshal(value)
	return data
}

func envelope(messageName string, sequence int, section string, values map[string]any) []byte {
	value := map[string]any{"recvTimestampMs": 1000, "sysId": 1, "compId": 1, "messageName": messageName, "sequence": sequence, "payload": map[string]any{"timestampMs": 1000, section: values}}
	data, _ := json.Marshal(value)
	return data
}
func TestCoreHealthSequenceAndTTL(t *testing.T) {
	c := New(5000)
	first := c.Ingest(heartbeat(0), 1000, "a")
	if len(first) != 1 || first[0].Sequence != 1 || len(first[0].Health.Systems) != 1 {
		t.Fatalf("unexpected first: %#v", first)
	}
	c.Ingest(heartbeat(0), 1000, "b")
	if len(c.TakeConflicts()) != 1 {
		t.Fatal("missing source conflict")
	}
	c.Tick(2000)
	third := c.Ingest(heartbeat(0), 2100, "")
	if third[0].Health.PacketRateHz != 2 || third[0].Health.MessageRates[0].RateHz != 2 {
		t.Fatalf("bad rates: %#v", third[0].Health)
	}
	c.Tick(7101)
	if c.SystemCount() != 0 {
		t.Fatal("strict TTL eviction failed")
	}
}
func TestCoreCountsInvalidJSON(t *testing.T) {
	c := New(5000)
	if got := c.Ingest([]byte(`{"messageName":"NOPE"}`), 1, ""); len(got) != 0 {
		t.Fatal(got)
	}
	frame := c.Ingest(heartbeat(1), 2, "")[0]
	if frame.Health.DecodeErrorCount != 1 || frame.Health.DroppedPacketCount != 1 {
		t.Fatalf("bad errors: %#v", frame.Health)
	}
}

func TestCoreSequenceWrapAndRateSort(t *testing.T) {
	c := New(5000)
	var output []OutputEnvelope
	for range 257 {
		output = c.Ingest(heartbeat(0), 1000, "")
	}
	if output[0].Sequence != 1 {
		t.Fatalf("sequence after wrap = %d, want 1", output[0].Sequence)
	}
	c.Ingest(envelope("ATTITUDE", 2, "attitude", map[string]any{"rollRad": 0, "pitchRad": 0, "yawRad": 0, "pitchSpeedRadPerSec": 0, "yawSpeedRadPerSec": 0}), 1000, "")
	c.Ingest(envelope("VFR_HUD", 3, "vfrHud", map[string]any{"airSpeedMps": 0, "groundSpeedMps": 0, "climbMps": 0, "headingDeg": 0}), 1000, "")
	c.Tick(2000)
	health := c.Ingest(heartbeat(4), 2001, "")[0].Health
	if len(health.MessageRates) != 3 || health.MessageRates[0] != (MessageRate{"HEARTBEAT", 257}) || health.MessageRates[1].MessageName != "ATTITUDE" || health.MessageRates[2].MessageName != "VFR_HUD" {
		t.Fatalf("rates not sorted by count then name: %#v", health.MessageRates)
	}
}
