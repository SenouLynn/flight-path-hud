package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/contractpath"
)

func main() {
	path, err := contractpath.Find("contracts/semantics/bridge-core-schedule.json")
	if err != nil {
		fail(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	var schedule struct {
		Steps []json.RawMessage `json:"steps"`
	}
	if err := json.Unmarshal(data, &schedule); err != nil {
		fail(err)
	}
	if len(schedule.Steps) == 0 {
		fail(fmt.Errorf("bridge core schedule has no steps"))
	}
	fmt.Printf("bridge-go conformance apparatus: loaded %d fixed-clock steps; Phase B-D execution blocked by documented contract question\n", len(schedule.Steps))
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
