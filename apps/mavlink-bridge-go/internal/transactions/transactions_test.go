package transactions

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/contractpath"
	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/recording"
)

type fakePort struct {
	available bool
	sendOK    bool
	sent      [][]byte
	targets   []Target
}

func (p *fakePort) CanSend(Target) bool { return p.available }
func (p *fakePort) Send(target Target, data []byte) bool {
	p.targets = append(p.targets, target)
	p.sent = append(p.sent, append([]byte(nil), data...))
	return p.sendOK
}

func TestReadNameIndexTargetRetryAndRouteLoss(t *testing.T) {
	port := &fakePort{available: true, sendOK: true}
	fold := NewReadFold(DefaultIdentity(), 100, 1)
	name := "ARSPD_FBW_MIN"
	frame := fold.Start(ParameterReadRequest{RequestID: "read", Target: Target{SysID: 2, CompID: 1}, Name: &name}, 1000, true, port)
	if frame.Status != "pending" || len(port.sent) != 1 || port.targets[0] != (Target{SysID: 2, CompID: 1}) {
		t.Fatalf("start = %#v sends=%d", frame, len(port.sent))
	}
	if got := fold.Ingest(Target{SysID: 1, CompID: 1}, ParamValue{ParamID: name, ParamIndex: 7}, 1010); got != nil {
		t.Fatal("peer target completed read")
	}
	complete := fold.Ingest(Target{SysID: 2, CompID: 1}, ParamValue{ParamID: name, ParamIndex: 7, ParamCount: 10, ParamType: 9, Value: 12}, 1020)
	if complete == nil || complete.Status != "complete" || complete.Value.Value != 12 {
		t.Fatalf("complete = %#v", complete)
	}

	index := 9
	fold.Start(ParameterReadRequest{RequestID: "index", Target: Target{SysID: 1, CompID: 1}, Index: &index}, 2000, true, port)
	if fold.Ingest(Target{SysID: 1, CompID: 1}, ParamValue{ParamID: "OTHER", ParamIndex: 8}, 2010) != nil {
		t.Fatal("wrong index completed read")
	}
	if got := fold.Ingest(Target{SysID: 1, CompID: 1}, ParamValue{ParamID: "OTHER", ParamIndex: 9}, 2020); got == nil || got.Status != "complete" {
		t.Fatalf("index completion = %#v", got)
	}

	fold.Start(ParameterReadRequest{RequestID: "retry", Target: Target{SysID: 1, CompID: 1}, Name: &name}, 3000, true, port)
	if got := fold.Tick(3099, port); len(got) != 0 {
		t.Fatalf("early tick = %#v", got)
	}
	if got := fold.Tick(3100, port); len(got) != 1 || got[0].Attempts != 2 {
		t.Fatalf("retry = %#v", got)
	}
	if !reflect.DeepEqual(port.sent[len(port.sent)-1], port.sent[len(port.sent)-2]) {
		t.Fatal("retry bytes changed")
	}
	port.available = false
	if got := fold.Tick(3200, port); len(got) != 1 || got[0].Status != "failed" || *got[0].Reason != "target route became stale while awaiting PARAM_VALUE" {
		t.Fatalf("route loss = %#v", got)
	}
}

func TestReadReplayInvalidAndRecordedAreTransmitFree(t *testing.T) {
	port := &fakePort{available: true, sendOK: true}
	fold := NewDefaultReadFold()
	name := "X"
	if got := fold.Start(ParameterReadRequest{RequestID: "replay", Target: Target{SysID: 1, CompID: 1}, Name: &name}, 0, false, port); got.Status != "failed" || len(port.sent) != 0 {
		t.Fatalf("replay = %#v", got)
	}
	if got := fold.Start(ParameterReadRequest{RequestID: "bad", Target: Target{SysID: 0, CompID: 1}, Name: &name}, 0, true, port); got.Status != "failed" || len(port.sent) != 0 {
		t.Fatalf("invalid = %#v", got)
	}
	raw := json.RawMessage(`{"type":"parameterRead","requestId":"old","sysId":2,"compId":1,"name":"X","index":null,"status":"complete","value":{"value":1,"paramCount":2,"paramIndex":0,"paramId":"X","paramType":9},"reason":null,"attempts":1,"updatedAtMs":10}`)
	if _, ok, err := FoldRecordedEvent(raw); err != nil || !ok || len(port.sent) != 0 {
		t.Fatalf("recorded ok=%v err=%v", ok, err)
	}
}

func TestReadMatchesOverlappingSelectorsInRequestOrder(t *testing.T) {
	port := &fakePort{available: true, sendOK: true}
	fold := NewDefaultReadFold()
	name := "MATCH"
	index := 7
	fold.Start(ParameterReadRequest{RequestID: "by-name", Target: Target{SysID: 2, CompID: 1}, Name: &name}, 0, true, port)
	fold.Start(ParameterReadRequest{RequestID: "by-index", Target: Target{SysID: 2, CompID: 1}, Index: &index}, 0, true, port)
	value := ParamValue{ParamID: name, ParamIndex: index, ParamCount: 10, ParamType: 9, Value: 1}
	first := fold.Ingest(Target{SysID: 2, CompID: 1}, value, 1)
	second := fold.Ingest(Target{SysID: 2, CompID: 1}, value, 2)
	if first == nil || second == nil || *first.RequestID != "by-name" || *second.RequestID != "by-index" {
		t.Fatalf("completion order first=%#v second=%#v", first, second)
	}
}

func TestExistingRecordedParameterReadsFoldPassively(t *testing.T) {
	path, err := contractpath.Find("apps/mavlink-bridge/test-fixtures/mixed-sitl-parameter-write-v2.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := recording.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	reads := 0
	for _, entry := range entries {
		result, ok, err := FoldRecordedEvent(entry.Event)
		if err != nil {
			t.Fatal(err)
		}
		if _, isRead := result.(ParameterReadFrame); ok && isRead {
			reads++
		}
	}
	if reads != 20 {
		t.Fatalf("passively folded parameter reads = %d", reads)
	}
}

func TestListSemanticTraceCases(t *testing.T) {
	path, err := contractpath.Find("contracts/semantics/parameter-list-trace.json")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Ordering struct {
			Steps []struct {
				CaseID string `json:"caseId"`
			} `json:"steps"`
		} `json:"orderingScenario"`
	}
	if err := json.Unmarshal(data, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Ordering.Steps) != 6 {
		t.Fatalf("trace ordering cases = %d", len(trace.Ordering.Steps))
	}

	port := &fakePort{available: true, sendOK: true}
	fold := NewListFold(DefaultIdentity(), 100, 1)
	start := fold.Start(ParameterListRequest{RequestID: "list", Target: Target{SysID: 2, CompID: 1}}, 0, true, port)
	if start.Frame.Status != "pending" || !start.Record {
		t.Fatalf("start = %#v", start)
	}
	if got := fold.Ingest(Target{SysID: 1, CompID: 1}, parameter(0, 3, 0), 1); got != nil {
		t.Fatal("peer target advanced list")
	}
	if got := fold.Ingest(Target{SysID: 2, CompID: 1}, parameter(2, 3, 2), 2); got == nil || got.Frame.ReceivedCount != 1 || got.Record {
		t.Fatalf("index2 = %#v", got)
	}
	if got := fold.Ingest(Target{SysID: 2, CompID: 1}, parameter(2, 3, 22), 3); got == nil || got.Frame.ReceivedCount != 1 {
		t.Fatalf("duplicate = %#v", got)
	}
	fold.Ingest(Target{SysID: 2, CompID: 1}, parameter(0, 3, 0), 4)
	complete := fold.Ingest(Target{SysID: 2, CompID: 1}, parameter(1, 3, 1), 5)
	if complete == nil || complete.Frame.Status != "complete" || !complete.Record {
		t.Fatalf("complete = %#v", complete)
	}
	if got := []int{complete.Frame.Parameters[0].ParamIndex, complete.Frame.Parameters[1].ParamIndex, complete.Frame.Parameters[2].ParamIndex}; !reflect.DeepEqual(got, []int{0, 1, 2}) {
		t.Fatalf("indexes = %#v", got)
	}
	if complete.Frame.Parameters[2].Value != 22 {
		t.Fatal("duplicate did not replace held value")
	}
	encoded, err := json.Marshal(complete.Frame)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal(encoded, &object); err != nil {
		t.Fatal(err)
	}
	if latest, exists := object["latest"]; !exists || latest != nil {
		t.Fatalf("complete lifecycle must include latest:null: %s", encoded)
	}
}

func TestListIdleRouteLossReplayAndInvalid(t *testing.T) {
	port := &fakePort{available: true, sendOK: true}
	fold := NewListFold(DefaultIdentity(), 100, 1)
	fold.Start(ParameterListRequest{RequestID: "idle", Target: Target{SysID: 1, CompID: 1}}, 0, true, port)
	if len(fold.Tick(99, port)) != 0 {
		t.Fatal("early idle tick emitted")
	}
	if got := fold.Tick(100, port); len(got) != 1 || got[0].Frame.Attempts != 2 {
		t.Fatalf("retry = %#v", got)
	}
	port.available = false
	if got := fold.Tick(200, port); len(got) != 1 || *got[0].Frame.Reason != "parameter list idle timeout" || len(port.sent) != 2 {
		t.Fatalf("route loss = %#v sends=%d", got, len(port.sent))
	}
	if got := NewDefaultListFold().Start(ParameterListRequest{RequestID: "r", Target: Target{SysID: 1, CompID: 1}}, 0, false, port); got.Frame.Status != "failed" {
		t.Fatalf("replay = %#v", got)
	}
	if got := NewDefaultListFold().Start(ParameterListRequest{RequestID: "x", Target: Target{SysID: 0, CompID: 1}}, 0, true, port); got.Frame.Status != "failed" {
		t.Fatalf("invalid = %#v", got)
	}
}

func TestListFailsIfExpectedCountChanges(t *testing.T) {
	path, err := contractpath.Find("contracts/semantics/parameter-list-trace.json")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Independent []struct {
			CaseID       string `json:"caseId"`
			FirstCount   int    `json:"firstCount"`
			ChangedCount int    `json:"changedCount"`
			WantStatus   string `json:"wantStatus"`
			WantReason   string `json:"wantReason"`
		} `json:"independentCases"`
	}
	if err := json.Unmarshal(data, &trace); err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		FirstCount, ChangedCount int
		WantStatus, WantReason   string
	}
	for _, candidate := range trace.Independent {
		if candidate.CaseID == "PARAM-COUNT-CHANGE" {
			fixture.FirstCount, fixture.ChangedCount = candidate.FirstCount, candidate.ChangedCount
			fixture.WantStatus, fixture.WantReason = candidate.WantStatus, candidate.WantReason
		}
	}
	if fixture.WantStatus == "" {
		t.Fatal("PARAM-COUNT-CHANGE trace case missing")
	}
	port := &fakePort{available: true, sendOK: true}
	fold := NewDefaultListFold()
	fold.Start(ParameterListRequest{RequestID: "count-change", Target: Target{SysID: 2, CompID: 1}}, 0, true, port)
	fold.Ingest(Target{SysID: 2, CompID: 1}, parameter(0, fixture.FirstCount, 0), 1)
	changed := fold.Ingest(Target{SysID: 2, CompID: 1}, parameter(1, fixture.ChangedCount, 1), 2)
	if changed == nil || changed.Frame.Status != fixture.WantStatus || changed.Frame.Reason == nil || *changed.Frame.Reason != fixture.WantReason || !changed.Record {
		t.Fatalf("count change = %#v", changed)
	}
	if next := fold.Ingest(Target{SysID: 2, CompID: 1}, parameter(2, 3, 2), 3); next != nil {
		t.Fatalf("failed list remained pending: %#v", next)
	}
}

func TestDefaultTimeoutThresholds(t *testing.T) {
	port := &fakePort{available: true, sendOK: true}
	name := "X"
	read := NewDefaultReadFold()
	read.Start(ParameterReadRequest{RequestID: "read-default", Target: Target{SysID: 1, CompID: 1}, Name: &name}, 0, true, port)
	if len(read.Tick(1499, port)) != 0 {
		t.Fatal("read retried before 1500ms")
	}
	if got := read.Tick(1500, port); got[0].Attempts != 2 {
		t.Fatalf("read retry1 = %#v", got)
	}
	if got := read.Tick(3000, port); got[0].Attempts != 3 {
		t.Fatalf("read retry2 = %#v", got)
	}
	if got := read.Tick(4500, port); got[0].Status != "failed" {
		t.Fatalf("read terminal = %#v", got)
	}

	list := NewDefaultListFold()
	list.Start(ParameterListRequest{RequestID: "list-default", Target: Target{SysID: 2, CompID: 1}}, 0, true, port)
	if len(list.Tick(2999, port)) != 0 {
		t.Fatal("list retried before 3000ms")
	}
	if got := list.Tick(3000, port); got[0].Frame.Attempts != 2 {
		t.Fatalf("list retry1 = %#v", got)
	}
	if got := list.Tick(6000, port); got[0].Frame.Attempts != 3 {
		t.Fatalf("list retry2 = %#v", got)
	}
	if got := list.Tick(9000, port); got[0].Frame.Status != "failed" {
		t.Fatalf("list terminal = %#v", got)
	}
}

func TestGoLifecycleShapesAreInSchemaValidatedFixture(t *testing.T) {
	path, err := contractpath.Find("contracts/fixtures/valid/bridge-lifecycle-frames.json")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture []map[string]any
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]map[string]any)
	for _, frame := range fixture {
		if requestID, ok := frame["requestId"].(string); ok {
			byID[requestID] = frame
		}
	}
	name := "ARSPD_FBW_MIN"
	readPort := &fakePort{available: true, sendOK: true}
	read := NewDefaultReadFold().Start(ParameterReadRequest{RequestID: "go-read-pending", Target: Target{SysID: 2, CompID: 1}, Name: &name}, 1000, true, readPort)
	listPort := &fakePort{available: true, sendOK: true}
	list := NewDefaultListFold().Start(ParameterListRequest{RequestID: "go-list-pending", Target: Target{SysID: 2, CompID: 1}}, 1000, true, listPort).Frame
	for requestID, generated := range map[string]any{"go-read-pending": read, "go-list-pending": list} {
		encoded, err := json.Marshal(generated)
		if err != nil {
			t.Fatal(err)
		}
		var object map[string]any
		if err := json.Unmarshal(encoded, &object); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(object, byID[requestID]) {
			t.Fatalf("%s lifecycle = %s, fixture = %#v", requestID, encoded, byID[requestID])
		}
	}
}

func parameter(index, count int, value float64) ParamValue {
	return ParamValue{ParamID: "P" + string(rune('0'+index)), ParamIndex: index, ParamCount: count, ParamType: 9, Value: value}
}

func DefaultIdentity() Target { return Target{SysID: 255, CompID: 190} }
