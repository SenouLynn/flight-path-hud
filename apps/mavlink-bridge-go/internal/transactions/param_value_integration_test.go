package transactions

import (
	"encoding/binary"
	"math"
	"testing"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/bridge"
	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/mavlink"
)

func TestRawParamValueCompletesOnlyExactTargetRead(t *testing.T) {
	payload := make([]byte, 25)
	binary.LittleEndian.PutUint32(payload, math.Float32bits(12.5))
	binary.LittleEndian.PutUint16(payload[4:], 1)
	copy(payload[8:], []byte("TEST_PARAM"))
	payload[24] = 9
	raw := mavlink.BuildV1(22, payload, 8, 2, 1, 220)
	core := bridge.New(5000)
	outputs := core.Ingest(raw, 1000, "")
	if len(outputs) != 1 {
		t.Fatalf("got %d envelopes", len(outputs))
	}
	target, value, ok := ParamValueFromEnvelope(outputs[0].Envelope)
	if !ok {
		t.Fatal("PARAM_VALUE adapter rejected normalized envelope")
	}
	name := "TEST_PARAM"
	fold := NewDefaultReadFold()
	port := &integrationPort{}
	fold.Start(ParameterReadRequest{RequestID: "read-1", Target: Target{SysID: 1, CompID: 1}, Name: &name}, 0, true, port)
	if completed := fold.Ingest(target, value, 1000); completed != nil {
		t.Fatal("peer target completed request")
	}
	fold.Start(ParameterReadRequest{RequestID: "read-2", Target: Target{SysID: 2, CompID: 1}, Name: &name}, 0, true, port)
	completed := fold.Ingest(target, value, 1000)
	if completed == nil || completed.Status != "complete" || completed.Value.ParamID != "TEST_PARAM" {
		t.Fatalf("unexpected completion: %#v", completed)
	}
}

type integrationPort struct{}

func (*integrationPort) CanSend(Target) bool      { return true }
func (*integrationPort) Send(Target, []byte) bool { return true }
