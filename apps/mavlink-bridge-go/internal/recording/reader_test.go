package recording

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/contractpath"
)

func TestReadRawFixtureAndDispatchAtMsUnpaced(t *testing.T) {
	path, err := contractpath.Find("apps/mavlink-bridge/test-fixtures/mixed-mavlink-v2.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 17 {
		t.Fatalf("entries = %d", len(entries))
	}
	var times []float64
	err = NewReplay(entries).Dispatch(func(data []byte, atMs float64) error {
		if len(data) == 0 {
			t.Fatal("empty datagram")
		}
		times = append(times, atMs)
		return nil
	}, func(json.RawMessage, float64) error {
		t.Fatal("raw-only fixture dispatched an event")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(times) != 17 || times[0] != entries[0].AtMs || times[16] != entries[16].AtMs {
		t.Fatalf("explicit times not preserved: %#v", times)
	}
}

func TestEventFixtureNeverDispatchesAsDatagram(t *testing.T) {
	path, err := contractpath.Find("apps/mavlink-bridge/test-fixtures/mixed-sitl-parameter-write-v2.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	reads, events := 0, 0
	err = NewReplay(entries).Dispatch(func([]byte, float64) error {
		t.Fatal("event entry dispatched as MAVLink")
		return nil
	}, func(event json.RawMessage, _ float64) error {
		events++
		var header struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(event, &header); err != nil {
			return err
		}
		if header.Type == "parameterRead" {
			reads++
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if events != 32 || reads != 20 {
		t.Fatalf("events=%d parameterRead=%d", events, reads)
	}
}

func TestReaderCopiesBytesAndReplayExposesNoOutboundMethod(t *testing.T) {
	entries, err := Read(bytes.NewBufferString("{\"tMs\":0,\"atMs\":1,\"base64\":\"AQI=\",\"event\":{\"type\":\"x\"}}\n"))
	if err != nil {
		t.Fatal(err)
	}
	replay := NewReplay(entries)
	entries[0].Data[0] = 9
	if _, ok := reflect.TypeOf(replay).MethodByName("Send"); ok {
		t.Fatal("replay exposes outbound Send")
	}
	var order []string
	if err := replay.Dispatch(func(data []byte, _ float64) error {
		if data[0] != 1 {
			t.Fatal("replay retained caller-owned buffer")
		}
		order = append(order, "data")
		return nil
	}, func(json.RawMessage, float64) error {
		order = append(order, "event")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(order, []string{"data", "event"}) {
		t.Fatalf("dispatch order = %#v", order)
	}
}

func TestReadRejectsMalformedJSONAndBase64(t *testing.T) {
	if _, err := Read(bytes.NewBufferString("{nope}\n")); err == nil {
		t.Fatal("malformed JSON accepted")
	}
	if _, err := Read(bytes.NewBufferString("{\"base64\":\"!\"}\n")); err == nil {
		t.Fatal("malformed base64 accepted")
	}
}
