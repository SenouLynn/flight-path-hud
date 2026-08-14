package transactions

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/mavlink"
)

type ParameterListRequest struct {
	RequestID string
	Target    Target
}

type ParameterListFrame struct {
	Type          string       `json:"type"`
	RequestID     *string      `json:"requestId"`
	SysID         *int         `json:"sysId"`
	CompID        *int         `json:"compId"`
	Status        string       `json:"status"`
	ReceivedCount int          `json:"receivedCount"`
	ExpectedCount *int         `json:"expectedCount"`
	Parameters    []ParamValue `json:"parameters"`
	Latest        *ParamValue  `json:"latest,omitempty"`
	LatestSet     bool         `json:"-"`
	Attempts      int          `json:"attempts,omitempty"`
	Reason        *string      `json:"reason"`
	UpdatedAtMs   float64      `json:"updatedAtMs"`
}

type ListOutput struct {
	Frame  ParameterListFrame
	Record bool
}

type listPending struct {
	frame  ParameterListFrame
	bytes  []byte
	values map[int]ParamValue
	key    string
}

type ListFold struct {
	source        mavlink.Identity
	idleTimeoutMs float64
	maxRetries    int
	sequence      byte
	pending       map[string]listPending
	targets       map[string]string
	order         []string
}

func NewListFold(source mavlink.Identity, idleTimeoutMs float64, maxRetries int) *ListFold {
	return &ListFold{source: source, idleTimeoutMs: idleTimeoutMs, maxRetries: maxRetries,
		pending: make(map[string]listPending), targets: make(map[string]string)}
}

func NewDefaultListFold() *ListFold    { return NewListFold(mavlink.DefaultGCSIdentity, 3000, 2) }
func (f *ListFold) nextSequence() byte { f.sequence++; return f.sequence }

func (f *ListFold) Start(request ParameterListRequest, atMs float64, live bool, port Port) ListOutput {
	frame := listBaseFrame(request, atMs)
	if strings.TrimSpace(request.RequestID) == "" {
		return ListOutput{Frame: listFailed(frame, "invalid requestId")}
	}
	if !validTarget(request.Target) {
		return ListOutput{Frame: listFailed(frame, "invalid non-broadcast target")}
	}
	if !live {
		return ListOutput{Frame: listFailed(frame, "replay mode: no live vehicle to query")}
	}
	if _, exists := f.pending[request.RequestID]; exists {
		return ListOutput{Frame: listFailed(frame, "duplicate requestId")}
	}
	key := targetKey(request.Target)
	if _, exists := f.targets[key]; exists {
		return ListOutput{Frame: listFailed(frame, "parameter list already pending for target")}
	}
	if port == nil || !port.CanSend(request.Target) {
		return ListOutput{Frame: listFailed(frame, "no live UDP endpoint for requested system")}
	}
	encoded := mavlink.EncodeParameterRequestList(f.source, request.Target, f.nextSequence())
	frame.Status, frame.Reason, frame.Attempts = "pending", nil, 1
	if !port.Send(request.Target, encoded) {
		return ListOutput{Frame: listFailed(frame, "route disappeared before transmit"), Record: true}
	}
	f.pending[request.RequestID] = listPending{frame: frame, bytes: append([]byte(nil), encoded...), values: make(map[int]ParamValue), key: key}
	f.targets[key] = request.RequestID
	f.order = append(f.order, request.RequestID)
	return ListOutput{Frame: frame, Record: true}
}

func (f *ListFold) Ingest(target Target, value ParamValue, atMs float64) *ListOutput {
	requestID, exists := f.targets[targetKey(target)]
	if !exists {
		return nil
	}
	pending := f.pending[requestID]
	if value.ParamCount < 1 || value.ParamIndex < 0 || value.ParamIndex >= value.ParamCount {
		return nil
	}
	pending.values[value.ParamIndex] = value
	expected := value.ParamCount
	complete := len(pending.values) == expected
	if complete {
		for index := range pending.values {
			if index >= expected {
				complete = false
				break
			}
		}
	}
	pending.frame.ExpectedCount = intPointer(expected)
	pending.frame.ReceivedCount = len(pending.values)
	pending.frame.UpdatedAtMs = atMs
	if complete {
		pending.frame.Status, pending.frame.Latest, pending.frame.LatestSet = "complete", nil, true
		pending.frame.Parameters = make([]ParamValue, 0, len(pending.values))
		for _, item := range pending.values {
			pending.frame.Parameters = append(pending.frame.Parameters, item)
		}
		sort.Slice(pending.frame.Parameters, func(i, j int) bool {
			return pending.frame.Parameters[i].ParamIndex < pending.frame.Parameters[j].ParamIndex
		})
		delete(f.pending, requestID)
		delete(f.targets, pending.key)
		f.order = without(f.order, requestID)
		return &ListOutput{Frame: pending.frame, Record: true}
	}
	pending.frame.Status, pending.frame.Parameters, pending.frame.Latest, pending.frame.LatestSet = "pending", []ParamValue{}, &value, true
	f.pending[requestID] = pending
	return &ListOutput{Frame: pending.frame, Record: false}
}

func (f ParameterListFrame) MarshalJSON() ([]byte, error) {
	type alias ParameterListFrame
	encoded, err := json.Marshal(alias(f))
	if err != nil || !f.LatestSet {
		return encoded, err
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &object); err != nil {
		return nil, err
	}
	latest, err := json.Marshal(f.Latest)
	if err != nil {
		return nil, err
	}
	object["latest"] = latest
	return json.Marshal(object)
}

func (f *ParameterListFrame) UnmarshalJSON(data []byte) error {
	type alias ParameterListFrame
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*f = ParameterListFrame(decoded)
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	_, f.LatestSet = object["latest"]
	return nil
}

func (f *ListFold) Tick(atMs float64, port Port) []ListOutput {
	result := make([]ListOutput, 0)
	for _, requestID := range append([]string(nil), f.order...) {
		pending, exists := f.pending[requestID]
		if !exists {
			continue
		}
		if atMs-pending.frame.UpdatedAtMs < f.idleTimeoutMs {
			continue
		}
		target := Target{SysID: byte(*pending.frame.SysID), CompID: byte(*pending.frame.CompID)}
		if pending.frame.Attempts <= f.maxRetries && port != nil && port.CanSend(target) && port.Send(target, append([]byte(nil), pending.bytes...)) {
			pending.frame.Attempts++
			pending.frame.UpdatedAtMs = atMs
			f.pending[requestID] = pending
			result = append(result, ListOutput{Frame: pending.frame, Record: true})
			continue
		}
		delete(f.pending, requestID)
		delete(f.targets, pending.key)
		f.order = without(f.order, requestID)
		pending.frame = listFailed(pending.frame, "parameter list idle timeout")
		pending.frame.UpdatedAtMs = atMs
		result = append(result, ListOutput{Frame: pending.frame, Record: true})
	}
	return result
}

func listBaseFrame(request ParameterListRequest, atMs float64) ParameterListFrame {
	requestID := stringPointer(request.RequestID)
	if request.RequestID == "" {
		requestID = nil
	}
	var sysID, compID *int
	if validTarget(request.Target) {
		sysID, compID = intPointer(int(request.Target.SysID)), intPointer(int(request.Target.CompID))
	}
	return ParameterListFrame{Type: "parameterList", RequestID: requestID, SysID: sysID, CompID: compID,
		Status: "failed", Parameters: []ParamValue{}, UpdatedAtMs: atMs}
}

func listFailed(frame ParameterListFrame, reason string) ParameterListFrame {
	frame.Status, frame.Reason = "failed", stringPointer(reason)
	return frame
}
