package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/contractpath"
	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/mavlink"
)

func main() {
	scheduleSteps := countArray("contracts/semantics/bridge-core-schedule.json", "steps")
	traceCases := countTraceCases()
	vectorCount := verifyParameterVectors()
	fmt.Printf("bridge-go conformance: %d fixed-clock steps, %d parameter vectors, %d parameter-list cases verified; Phase B core equality remains blocked by documented contract questions\n", scheduleSteps, vectorCount, traceCases)
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
