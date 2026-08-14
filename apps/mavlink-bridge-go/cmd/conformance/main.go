package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/bridge"
	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/contractpath"
	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/mavlink"
)

func main() {
	scheduleSteps := countArray("contracts/semantics/bridge-core-schedule.json", "steps")
	traceCases := countTraceCases()
	vectorCount := verifyParameterVectors()
	goOutput := runSchedule()
	compareNode(goOutput)
	fmt.Printf("bridge-go conformance: Node/Go core equality passed for %d fixed-clock steps; %d parameter vectors and %d parameter-list cases verified\n", scheduleSteps, vectorCount, traceCases)
}

type schedule struct {
	SystemTTL float64        `json:"systemTtlMs"`
	Steps     []scheduleStep `json:"steps"`
}
type scheduleStep struct {
	Kind     string          `json:"kind"`
	AtMs     float64         `json:"atMs"`
	Source   string          `json:"source"`
	Envelope json.RawMessage `json:"envelope"`
}
type scheduleEvent struct {
	Kind        string                  `json:"kind"`
	AtMs        float64                 `json:"atMs"`
	Envelopes   []bridge.OutputEnvelope `json:"envelopes,omitempty"`
	Conflicts   []bridge.SourceConflict `json:"conflicts,omitempty"`
	SystemCount *int                    `json:"systemCount,omitempty"`
}
type scheduleOutput struct {
	Events []scheduleEvent `json:"events"`
}

func runSchedule() scheduleOutput {
	path, err := contractpath.Find("contracts/semantics/bridge-core-schedule.json")
	if err != nil {
		fail(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	var input schedule
	if err := json.Unmarshal(data, &input); err != nil {
		fail(err)
	}
	core := bridge.New(input.SystemTTL)
	output := scheduleOutput{Events: []scheduleEvent{}}
	for _, step := range input.Steps {
		switch step.Kind {
		case "ingest":
			envelopes := core.Ingest(step.Envelope, step.AtMs, step.Source)
			output.Events = append(output.Events, scheduleEvent{Kind: "ingest", AtMs: step.AtMs, Envelopes: envelopes})
			if conflicts := core.TakeConflicts(); len(conflicts) > 0 {
				output.Events = append(output.Events, scheduleEvent{Kind: "conflicts", AtMs: step.AtMs, Conflicts: conflicts})
			}
		case "tick":
			core.Tick(step.AtMs)
			count := core.SystemCount()
			output.Events = append(output.Events, scheduleEvent{Kind: "tick", AtMs: step.AtMs, SystemCount: &count})
		default:
			fail(fmt.Errorf("unsupported schedule step %q", step.Kind))
		}
	}
	return output
}

func compareNode(goOutput scheduleOutput) {
	schedulePath, err := contractpath.Find("contracts/semantics/bridge-core-schedule.json")
	if err != nil {
		fail(err)
	}
	nodePath, err := contractpath.Find("apps/mavlink-bridge/src/goConformance.js")
	if err != nil {
		fail(err)
	}
	command := exec.Command("node", nodePath, schedulePath)
	command.Dir = filepath.Dir(nodePath)
	nodeBytes, err := command.Output()
	if err != nil {
		fail(fmt.Errorf("Node conformance harness: %w", err))
	}
	goBytes, err := json.Marshal(goOutput)
	if err != nil {
		fail(err)
	}
	var nodeValue, goValue any
	decoder := json.NewDecoder(bytes.NewReader(nodeBytes))
	decoder.UseNumber()
	if err := decoder.Decode(&nodeValue); err != nil {
		fail(err)
	}
	decoder = json.NewDecoder(bytes.NewReader(goBytes))
	decoder.UseNumber()
	if err := decoder.Decode(&goValue); err != nil {
		fail(err)
	}
	if !reflect.DeepEqual(nodeValue, goValue) {
		fail(fmt.Errorf("Node/Go fixed-clock core mismatch\nnode: %s\ngo:   %s", bytes.TrimSpace(nodeBytes), goBytes))
	}
}

func readObject(relative string) map[string]json.RawMessage {
	path, err := contractpath.Find(relative)
	if err != nil {
		fail(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		fail(err)
	}
	return object
}

func countArray(relative, key string) int {
	object := readObject(relative)
	var values []json.RawMessage
	if err := json.Unmarshal(object[key], &values); err != nil || len(values) == 0 {
		fail(fmt.Errorf("%s.%s has no cases", relative, key))
	}
	return len(values)
}

func countTraceCases() int {
	object := readObject("contracts/semantics/parameter-list-trace.json")
	count := 0
	for _, key := range []string{"orderingScenario", "idleScenario"} {
		var scenario struct {
			Steps []json.RawMessage `json:"steps"`
		}
		if err := json.Unmarshal(object[key], &scenario); err != nil {
			fail(err)
		}
		count += len(scenario.Steps)
	}
	var independent []json.RawMessage
	if err := json.Unmarshal(object["independentCases"], &independent); err != nil {
		fail(err)
	}
	return count + len(independent)
}

func verifyParameterVectors() int {
	object := readObject("contracts/mavlink/parameter-command-vectors.json")
	var vectors []struct {
		Target   mavlink.Identity `json:"target"`
		Selector struct {
			Name  *string `json:"name"`
			Index *int    `json:"index"`
			List  bool    `json:"list"`
		} `json:"selector"`
		PayloadHex string `json:"payloadHex"`
	}
	if err := json.Unmarshal(object["vectors"], &vectors); err != nil {
		fail(err)
	}
	for _, vector := range vectors {
		var payload []byte
		var err error
		if vector.Selector.List {
			payload = mavlink.EncodeParameterRequestListPayload(vector.Target)
		} else {
			payload, err = mavlink.EncodeParameterRequestReadPayload(vector.Target, vector.Selector.Name, vector.Selector.Index)
		}
		if err != nil || hex.EncodeToString(payload) != vector.PayloadHex {
			fail(fmt.Errorf("parameter vector mismatch: got %x want %s: %v", payload, vector.PayloadHex, err))
		}
	}
	return len(vectors)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
