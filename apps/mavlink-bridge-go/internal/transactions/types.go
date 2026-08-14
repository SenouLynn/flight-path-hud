// Package transactions contains pure, explicitly-clocked parameter folds.
package transactions

import (
	"encoding/json"
	"fmt"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/mavlink"
)

type Target = mavlink.Identity

type Port interface {
	CanSend(Target) bool
	Send(Target, []byte) bool
}

type ParamValue struct {
	Value      float64 `json:"value"`
	ParamCount int     `json:"paramCount"`
	ParamIndex int     `json:"paramIndex"`
	ParamID    string  `json:"paramId"`
	ParamType  int     `json:"paramType"`
}

func validTarget(target Target) bool { return target.SysID > 0 && target.CompID > 0 }

func stringPointer(value string) *string { return &value }
func intPointer(value int) *int          { return &value }

func FoldRecordedEvent(raw json.RawMessage) (any, bool, error) {
	var header struct {
		Type      string  `json:"type"`
		RequestID *string `json:"requestId"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		return nil, false, err
	}
	if header.RequestID == nil {
		return nil, false, nil
	}
	switch header.Type {
	case "parameterRead":
		var frame ParameterReadFrame
		if err := json.Unmarshal(raw, &frame); err != nil {
			return nil, false, err
		}
		return frame, true, nil
	case "parameterList":
		var frame ParameterListFrame
		if err := json.Unmarshal(raw, &frame); err != nil {
			return nil, false, err
		}
		return frame, true, nil
	default:
		return nil, false, nil
	}
}

func targetKey(target Target) string { return fmt.Sprintf("%d:%d", target.SysID, target.CompID) }

func without(items []string, value string) []string {
	for index, item := range items {
		if item == value {
			return append(items[:index], items[index+1:]...)
		}
	}
	return items
}
