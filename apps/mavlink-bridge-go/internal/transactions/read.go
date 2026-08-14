package transactions

import (
	"fmt"
	"strings"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/mavlink"
)

type ParameterReadRequest struct {
	RequestID string
	Target    Target
	Name      *string
	Index     *int
}

type ParameterReadFrame struct {
	Type        string      `json:"type"`
	RequestID   *string     `json:"requestId"`
	SysID       *int        `json:"sysId"`
	CompID      *int        `json:"compId"`
	Name        *string     `json:"name"`
	Index       *int        `json:"index"`
	Status      string      `json:"status"`
	Value       *ParamValue `json:"value"`
	Reason      *string     `json:"reason"`
	Attempts    int         `json:"attempts,omitempty"`
	UpdatedAtMs float64     `json:"updatedAtMs"`
}

type readPending struct {
	frame ParameterReadFrame
	bytes []byte
	key   string
}

type ReadFold struct {
	source     mavlink.Identity
	timeoutMs  float64
	maxRetries int
	sequence   byte
	pending    map[string]readPending
	queries    map[string]string
	order      []string
}

func NewReadFold(source mavlink.Identity, timeoutMs float64, maxRetries int) *ReadFold {
	return &ReadFold{source: source, timeoutMs: timeoutMs, maxRetries: maxRetries,
		pending: make(map[string]readPending), queries: make(map[string]string)}
}

func NewDefaultReadFold() *ReadFold { return NewReadFold(mavlink.DefaultGCSIdentity, 1500, 2) }

func (f *ReadFold) nextSequence() byte { f.sequence++; return f.sequence }

func (f *ReadFold) Start(request ParameterReadRequest, atMs float64, live bool, port Port) ParameterReadFrame {
	frame := readBaseFrame(request, atMs)
	if reason := validateRead(request); reason != "" {
		return readFailed(frame, reason)
	}
	if !live {
		return readFailed(frame, "replay mode: no live vehicle to query")
	}
	if _, exists := f.pending[request.RequestID]; exists {
		return readFailed(frame, "duplicate requestId")
	}
	key := readQueryKey(request)
	if _, exists := f.queries[key]; exists {
		return readFailed(frame, "same parameter read already pending for target")
	}
	if port == nil || !port.CanSend(request.Target) {
		return readFailed(frame, "no live UDP endpoint for requested system")
	}
	encoded, err := mavlink.EncodeParameterRequestRead(f.source, request.Target, request.Name, request.Index, f.nextSequence())
	if err != nil {
		return readFailed(frame, err.Error())
	}
	frame.Status, frame.Attempts = "pending", 1
	if !port.Send(request.Target, encoded) {
		return readFailed(frame, "target route disappeared before transmit")
	}
	f.pending[request.RequestID] = readPending{frame: frame, bytes: append([]byte(nil), encoded...), key: key}
	f.queries[key] = request.RequestID
	f.order = append(f.order, request.RequestID)
	return frame
}

func (f *ReadFold) Ingest(target Target, value ParamValue, atMs float64) *ParameterReadFrame {
	// Match in request order, as Node's Map iteration does. A PARAM_VALUE can
	// legitimately match a pending name read and a pending index read at once;
	// ranging over the Go map would make which request completes nondeterministic.
	for _, requestID := range append([]string(nil), f.order...) {
		pending, exists := f.pending[requestID]
		if !exists {
			continue
		}
		if pending.frame.SysID == nil || pending.frame.CompID == nil || *pending.frame.SysID != int(target.SysID) || *pending.frame.CompID != int(target.CompID) {
			continue
		}
		matched := pending.frame.Name != nil && value.ParamID == *pending.frame.Name
		matched = matched || (pending.frame.Index != nil && value.ParamIndex == *pending.frame.Index)
		if !matched {
			continue
		}
		delete(f.pending, requestID)
		delete(f.queries, pending.key)
		f.order = without(f.order, requestID)
		pending.frame.Status, pending.frame.Value, pending.frame.Reason, pending.frame.UpdatedAtMs = "complete", &value, nil, atMs
		return &pending.frame
	}
	return nil
}

func (f *ReadFold) Tick(atMs float64, port Port) []ParameterReadFrame {
	result := make([]ParameterReadFrame, 0)
	for _, requestID := range append([]string(nil), f.order...) {
		pending, exists := f.pending[requestID]
		if !exists {
			continue
		}
		if atMs-pending.frame.UpdatedAtMs < f.timeoutMs {
			continue
		}
		target := Target{SysID: byte(*pending.frame.SysID), CompID: byte(*pending.frame.CompID)}
		if pending.frame.Attempts <= f.maxRetries && port != nil && port.CanSend(target) && port.Send(target, append([]byte(nil), pending.bytes...)) {
			pending.frame.Attempts++
			pending.frame.UpdatedAtMs = atMs
			f.pending[requestID] = pending
			result = append(result, pending.frame)
			continue
		}
		delete(f.pending, requestID)
		delete(f.queries, pending.key)
		f.order = without(f.order, requestID)
		reason := "target route became stale while awaiting PARAM_VALUE"
		if port != nil && port.CanSend(target) {
			reason = "PARAM_VALUE timeout"
		}
		pending.frame = readFailed(pending.frame, reason)
		pending.frame.UpdatedAtMs = atMs
		result = append(result, pending.frame)
	}
	return result
}

func readBaseFrame(request ParameterReadRequest, atMs float64) ParameterReadFrame {
	requestID := stringPointer(request.RequestID)
	if request.RequestID == "" {
		requestID = nil
	}
	var sysID, compID *int
	if validTarget(request.Target) {
		sysID, compID = intPointer(int(request.Target.SysID)), intPointer(int(request.Target.CompID))
	}
	return ParameterReadFrame{Type: "parameterRead", RequestID: requestID, SysID: sysID, CompID: compID,
		Name: request.Name, Index: request.Index, Status: "failed", Reason: nil, UpdatedAtMs: atMs}
}

func validateRead(request ParameterReadRequest) string {
	if strings.TrimSpace(request.RequestID) == "" {
		return "invalid requestId"
	}
	if !validTarget(request.Target) {
		return "invalid target: expected non-broadcast uint8 sysId/compId"
	}
	if (request.Name == nil) == (request.Index == nil) {
		return "specify exactly one of parameter name or index"
	}
	if request.Name != nil {
		name := []byte(*request.Name)
		if len(name) == 0 || len(name) > 16 {
			return "parameter name must be 1-16 printable ASCII bytes"
		}
		for _, value := range name {
			if value < 0x20 || value > 0x7e {
				return "parameter name must be 1-16 printable ASCII bytes"
			}
		}
	}
	if request.Index != nil && (*request.Index < 0 || *request.Index > 32767) {
		return "parameter index must be in the range 0-32767"
	}
	return ""
}

func readFailed(frame ParameterReadFrame, reason string) ParameterReadFrame {
	frame.Status, frame.Value, frame.Reason = "failed", nil, stringPointer(reason)
	return frame
}

func readQueryKey(request ParameterReadRequest) string {
	selector := ""
	if request.Name != nil {
		selector = "$" + *request.Name
	} else {
		selector = fmt.Sprintf("#%d", *request.Index)
	}
	return targetKey(request.Target) + ":" + selector
}
