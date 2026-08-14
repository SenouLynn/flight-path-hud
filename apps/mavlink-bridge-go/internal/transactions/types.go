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

// ParamValueFromEnvelope is the only normalization-to-transaction seam in the
// offline slice. It preserves exact source identity for correlation by callers.
func ParamValueFromEnvelope(envelope mavlink.Envelope) (Target, ParamValue, bool) {
	if envelope.MessageName != "PARAM_VALUE" {
		return Target{}, ParamValue{}, false
	}
	value, ok := envelope.Payload["paramValue"].(map[string]any)
	if !ok {
		return Target{}, ParamValue{}, false
	}
	number := func(key string) (float64, bool) {
		item, ok := value[key]
		if !ok {
			return 0, false
		}
		switch typed := item.(type) {
		case float64:
			return typed, true
		case int64:
			return float64(typed), true
		case int:
			return float64(typed), true
		}
		return 0, false
	}
	parameterValue, okValue := number("value")
	count, okCount := number("paramCount")
	index, okIndex := number("paramIndex")
	parameterType, okType := number("paramType")
	id, okID := value["paramId"].(string)
	if !(okValue && okCount && okIndex && okType && okID) {
		return Target{}, ParamValue{}, false
	}
	return Target{SysID: envelope.SysID, CompID: envelope.CompID}, ParamValue{Value: parameterValue, ParamCount: int(count), ParamIndex: int(index), ParamID: id, ParamType: int(parameterType)}, true
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
