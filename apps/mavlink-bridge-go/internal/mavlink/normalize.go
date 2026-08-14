package mavlink

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
)

type Envelope struct {
	RecvTimestampMs float64        `json:"recvTimestampMs"`
	SysID           byte           `json:"sysId"`
	CompID          byte           `json:"compId"`
	MessageName     string         `json:"messageName"`
	Sequence        byte           `json:"sequence"`
	Payload         map[string]any `json:"payload"`
}

type messageDefinition struct {
	name     string
	crcExtra byte
	min, max int
	decode   func([]byte, float64) map[string]any
}

var definitions = map[uint32]messageDefinition{
	0: {"HEARTBEAT", 50, 9, 9, decodeHeartbeat}, 22: {"PARAM_VALUE", 220, 25, 25, decodeParamValue},
	24: {"GPS_RAW_INT", 24, 30, 52, decodeGPSRaw}, 30: {"ATTITUDE", 39, 28, 28, decodeAttitude},
	33: {"GLOBAL_POSITION_INT", 104, 28, 28, decodeGlobalPosition}, 40: {"MISSION_REQUEST", 230, 4, 5, decodeMissionRequest},
	42: {"MISSION_CURRENT", 28, 2, 18, decodeMissionCurrent}, 44: {"MISSION_COUNT", 221, 4, 9, decodeMissionCount},
	47: {"MISSION_ACK", 153, 3, 8, decodeMissionAck}, 49: {"GPS_GLOBAL_ORIGIN", 39, 12, 20, decodeOrigin},
	51: {"MISSION_REQUEST_INT", 196, 4, 5, decodeMissionRequestInt}, 73: {"MISSION_ITEM_INT", 38, 37, 38, decodeMissionItem},
	74: {"VFR_HUD", 20, 20, 20, decodeVFR}, 77: {"COMMAND_ACK", 143, 3, 10, decodeCommandAck},
	242: {"HOME_POSITION", 104, 52, 60, decodeHome},
}

func ParseDatagram(raw []byte, nowMs float64) ([]Envelope, int) {
	if envelope, ok := parseJSONEnvelope(raw); ok {
		return []Envelope{envelope}, 0
	}
	return parseBinary(raw, nowMs)
}

func parseBinary(raw []byte, nowMs float64) ([]Envelope, int) {
	result := []Envelope{}
	errors, sawPrefix := 0, false
	for offset := 0; offset < len(raw); {
		magic := raw[offset]
		if magic != 0xfe && magic != 0xfd {
			offset++
			continue
		}
		sawPrefix = true
		if offset+2 > len(raw) {
			errors++
			break
		}
		payloadLength := int(raw[offset+1])
		frameLength, payloadOffset, sequenceOffset, sysOffset, compOffset := payloadLength+8, offset+6, offset+2, offset+3, offset+4
		var messageID uint32
		if magic == 0xfe {
			if offset+6 > len(raw) {
				errors++
				break
			}
			messageID = uint32(raw[offset+5])
		} else {
			if offset+10 > len(raw) {
				errors++
				break
			}
			signatureLength := 0
			if raw[offset+2]&1 != 0 {
				signatureLength = 13
			}
			frameLength, payloadOffset, sequenceOffset, sysOffset, compOffset = payloadLength+12+signatureLength, offset+10, offset+4, offset+5, offset+6
			messageID = uint32(raw[offset+7]) | uint32(raw[offset+8])<<8 | uint32(raw[offset+9])<<16
		}
		if offset+frameLength > len(raw) {
			errors++
			next := nextFramePrefix(raw, offset+1)
			if next < 0 {
				break
			}
			offset = next
			continue
		}
		// No v2 incompatibility feature is supported in this slice. MAVLink
		// requires receivers to drop frames with an unknown incompatibility bit;
		// signing (bit 0) is likewise rejected until verification is implemented.
		if magic == 0xfd && raw[offset+2] != 0 {
			errors++
			offset += frameLength
			continue
		}
		definition, supported := definitions[messageID]
		if !supported {
			offset += frameLength
			continue
		}
		validLength := magic == 0xfe && payloadLength == definition.min || magic == 0xfd && payloadLength >= 1 && payloadLength <= definition.max
		if !validLength {
			errors++
			offset += frameLength
			continue
		}
		crcOffset := payloadOffset + payloadLength
		expected := binary.LittleEndian.Uint16(raw[crcOffset : crcOffset+2])
		actual := ComputeCRC(raw[offset+1:crcOffset], definition.crcExtra)
		if expected != actual {
			errors++
			next := nextFramePrefix(raw, offset+1)
			if next < 0 {
				break
			}
			offset = next
			continue
		}
		payload := append([]byte(nil), raw[payloadOffset:crcOffset]...)
		if magic == 0xfd && len(payload) < definition.max {
			payload = append(payload, make([]byte, definition.max-len(payload))...)
		}
		decoded := definition.decode(payload, nowMs)
		if decoded == nil || !allFinite(decoded) {
			errors++
			offset += frameLength
			continue
		}
		result = append(result, Envelope{nowMs, raw[sysOffset], raw[compOffset], definition.name, raw[sequenceOffset], decoded})
		offset += frameLength
	}
	if len(result) == 0 && !sawPrefix {
		errors++
	}
	return result, errors
}

func nextFramePrefix(raw []byte, from int) int {
	for index := from; index < len(raw); index++ {
		if raw[index] == 0xfe || raw[index] == 0xfd {
			return index
		}
	}
	return -1
}

func allFinite(value any) bool {
	switch typed := value.(type) {
	case float64:
		return !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case map[string]any:
		for _, child := range typed {
			if !allFinite(child) {
				return false
			}
		}
	case []any:
		for _, child := range typed {
			if !allFinite(child) {
				return false
			}
		}
	}
	return true
}

func parseJSONEnvelope(raw []byte) (Envelope, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if decoder.Decode(&value) != nil {
		return Envelope{}, false
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return Envelope{}, false
	}
	root, ok := exactObject(value, "recvTimestampMs", "sysId", "compId", "messageName", "sequence", "payload")
	if !ok {
		return Envelope{}, false
	}
	recv, ok1 := finite(root["recvTimestampMs"])
	sys, ok2 := uint(root["sysId"], 8)
	comp, ok3 := uint(root["compId"], 8)
	seq, ok4 := uint(root["sequence"], 8)
	name, ok5 := root["messageName"].(string)
	payload, ok6 := root["payload"].(map[string]any)
	if !(ok1 && ok2 && ok3 && ok4 && ok5 && ok6) {
		return Envelope{}, false
	}
	definition, found := definitionByName(name)
	if !found || !validJSONPayload(name, payload) {
		return Envelope{}, false
	}
	_ = definition
	normalizedPayload := jsonNumbers(payload).(map[string]any)
	return Envelope{recv, byte(sys), byte(comp), name, byte(seq), normalizedPayload}, true
}

func definitionByName(name string) (messageDefinition, bool) {
	for _, d := range definitions {
		if d.name == name {
			return d, true
		}
	}
	return messageDefinition{}, false
}
func exactObject(value any, keys ...string) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	if !ok || len(object) != len(keys) {
		return nil, false
	}
	for _, key := range keys {
		if _, ok := object[key]; !ok {
			return nil, false
		}
	}
	return object, true
}
func finite(value any) (float64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	parsed, err := number.Float64()
	return parsed, err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
}
func uint(value any, bits int) (uint64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	parsed, err := number.Int64()
	max := int64(1<<bits) - 1
	return uint64(parsed), err == nil && parsed >= 0 && parsed <= max
}
func sint(value any, bits int) bool {
	number, ok := value.(json.Number)
	if !ok {
		return false
	}
	parsed, err := number.Int64()
	min, max := -int64(1<<(bits-1)), int64(1<<(bits-1))-1
	return err == nil && parsed >= min && parsed <= max
}
func boolean(value any) bool { _, ok := value.(bool); return ok }
func number(value any) bool  { _, ok := finite(value); return ok }
func jsonNumbers(value any) any {
	switch item := value.(type) {
	case json.Number:
		if i, err := item.Int64(); err == nil {
			return i
		}
		f, _ := item.Float64()
		return f
	case map[string]any:
		out := map[string]any{}
		for k, v := range item {
			out[k] = jsonNumbers(v)
		}
		return out
	case []any:
		for i := range item {
			item[i] = jsonNumbers(item[i])
		}
		return item
	}
	return value
}

type fieldCheck struct {
	name  string
	check func(any) bool
}

func validJSONPayload(name string, payload map[string]any) bool {
	sectionNames := map[string]string{"HEARTBEAT": "heartbeat", "PARAM_VALUE": "paramValue", "GPS_RAW_INT": "gpsRawInt", "ATTITUDE": "attitude", "GLOBAL_POSITION_INT": "globalPositionInt", "MISSION_REQUEST": "missionRequest", "MISSION_CURRENT": "missionCurrent", "MISSION_COUNT": "missionCount", "MISSION_ACK": "missionAck", "GPS_GLOBAL_ORIGIN": "gpsGlobalOrigin", "MISSION_REQUEST_INT": "missionRequestInt", "MISSION_ITEM_INT": "missionItemInt", "VFR_HUD": "vfrHud", "COMMAND_ACK": "commandAck", "HOME_POSITION": "homePosition"}
	sectionName := sectionNames[name]
	object, ok := exactObject(payload, "timestampMs", sectionName)
	if !ok || !number(object["timestampMs"]) {
		return false
	}
	section, ok := object[sectionName].(map[string]any)
	if !ok {
		return false
	}
	u8 := func(v any) bool { _, ok := uint(v, 8); return ok }
	u16 := func(v any) bool { _, ok := uint(v, 16); return ok }
	u32 := func(v any) bool { _, ok := uint(v, 32); return ok }
	i16 := func(v any) bool { return sint(v, 16) }
	i32 := func(v any) bool { return sint(v, 32) }
	checks := map[string][]fieldCheck{
		"HEARTBEAT": {{"customMode", u32}, {"vehicleType", u8}, {"autopilotType", u8}, {"baseMode", u8}, {"armed", boolean}, {"systemStatus", u8}, {"mavlinkVersion", u8}},
		"PARAM_VALUE": {{"value", number}, {"paramCount", u16}, {"paramIndex", u16}, {"paramId", func(v any) bool {
			s, ok := v.(string)
			if !ok || len(s) > 16 {
				return false
			}
			for _, b := range []byte(s) {
				if b > 0x7f || b == 0 {
					return false
				}
			}
			return true
		}}, {"paramType", u8}},
		"GPS_RAW_INT": {{"velCms", u16}, {"cogCdeg", u16}}, "ATTITUDE": {{"rollRad", number}, {"pitchRad", number}, {"yawRad", number}, {"pitchSpeedRadPerSec", number}, {"yawSpeedRadPerSec", number}},
		"GLOBAL_POSITION_INT": {{"latDegE7", i32}, {"lonDegE7", i32}, {"altMm", i32}, {"relativeAltMm", i32}, {"vxCms", i16}, {"vyCms", i16}, {"vzCms", i16}, {"headingCdeg", u16}},
		"VFR_HUD":             {{"airSpeedMps", number}, {"groundSpeedMps", number}, {"climbMps", number}, {"headingDeg", i16}}, "COMMAND_ACK": {{"command", u16}, {"result", u8}},
		"MISSION_COUNT": {{"count", u16}}, "MISSION_CURRENT": {{"seq", u16}}, "MISSION_ACK": {{"type", u8}},
		"MISSION_REQUEST": {{"seq", u16}, {"targetSystem", u8}, {"targetComponent", u8}}, "MISSION_REQUEST_INT": {{"seq", u16}, {"targetSystem", u8}, {"targetComponent", u8}},
		"GPS_GLOBAL_ORIGIN": {{"latDegE7", i32}, {"lonDegE7", i32}, {"altMm", i32}}, "HOME_POSITION": {{"latDegE7", i32}, {"lonDegE7", i32}, {"altMm", i32}},
		"MISSION_ITEM_INT": {{"seq", u16}, {"command", u16}, {"frameId", u8}, {"current", boolean}, {"autocontinue", boolean}, {"param1", number}, {"param2", number}, {"param3", number}, {"param4", number}, {"latDegE7", i32}, {"lonDegE7", i32}, {"altM", number}},
	}
	fields := checks[name]
	if len(section) != len(fields) {
		return false
	}
	for _, field := range fields {
		value, ok := section[field.name]
		if !ok || !field.check(value) {
			return false
		}
	}
	return true
}

func f32(p []byte, o int) float64 {
	value := float64(math.Float32frombits(binary.LittleEndian.Uint32(p[o:])))
	// JSON.stringify canonicalizes JavaScript -0 to 0. Normalize here so a
	// future Go JSON adapter emits the same protocol-v0 number spelling.
	if value == 0 {
		return 0
	}
	return value
}
func i32(p []byte, o int) int64 { return int64(int32(binary.LittleEndian.Uint32(p[o:]))) }
func i16(p []byte, o int) int64 { return int64(int16(binary.LittleEndian.Uint16(p[o:]))) }
func u16(p []byte, o int) int64 { return int64(binary.LittleEndian.Uint16(p[o:])) }
func sample(ts float64, key string, value map[string]any) map[string]any {
	return map[string]any{"timestampMs": ts, key: value}
}
func decodeHeartbeat(p []byte, t float64) map[string]any {
	b := p[6]
	return sample(t, "heartbeat", map[string]any{"customMode": int64(binary.LittleEndian.Uint32(p)), "vehicleType": int64(p[4]), "autopilotType": int64(p[5]), "baseMode": int64(b), "armed": b&0x80 != 0, "systemStatus": int64(p[7]), "mavlinkVersion": int64(p[8])})
}
func decodeParamValue(p []byte, t float64) map[string]any {
	end := bytes.IndexByte(p[8:24], 0)
	if end < 0 {
		end = 16
	}
	for _, value := range p[8 : 8+end] {
		if value == 0 || value > 0x7f {
			return nil
		}
	}
	return sample(t, "paramValue", map[string]any{"value": f32(p, 0), "paramCount": u16(p, 4), "paramIndex": u16(p, 6), "paramId": string(p[8 : 8+end]), "paramType": int64(p[24])})
}
func decodeGPSRaw(p []byte, t float64) map[string]any {
	return sample(t, "gpsRawInt", map[string]any{"velCms": u16(p, 24), "cogCdeg": u16(p, 26)})
}
func decodeAttitude(p []byte, t float64) map[string]any {
	return sample(t, "attitude", map[string]any{"rollRad": f32(p, 4), "pitchRad": f32(p, 8), "yawRad": f32(p, 12), "pitchSpeedRadPerSec": f32(p, 20), "yawSpeedRadPerSec": f32(p, 24)})
}
func decodeGlobalPosition(p []byte, t float64) map[string]any {
	return sample(t, "globalPositionInt", map[string]any{"latDegE7": i32(p, 4), "lonDegE7": i32(p, 8), "altMm": i32(p, 12), "relativeAltMm": i32(p, 16), "vxCms": i16(p, 20), "vyCms": i16(p, 22), "vzCms": i16(p, 24), "headingCdeg": u16(p, 26)})
}
func decodeMissionRequest(p []byte, t float64) map[string]any {
	return sample(t, "missionRequest", map[string]any{"seq": u16(p, 0), "targetSystem": int64(p[2]), "targetComponent": int64(p[3])})
}
func decodeMissionRequestInt(p []byte, t float64) map[string]any {
	return sample(t, "missionRequestInt", map[string]any{"seq": u16(p, 0), "targetSystem": int64(p[2]), "targetComponent": int64(p[3])})
}
func decodeMissionCurrent(p []byte, t float64) map[string]any {
	return sample(t, "missionCurrent", map[string]any{"seq": u16(p, 0)})
}
func decodeMissionCount(p []byte, t float64) map[string]any {
	return sample(t, "missionCount", map[string]any{"count": u16(p, 0)})
}
func decodeMissionAck(p []byte, t float64) map[string]any {
	return sample(t, "missionAck", map[string]any{"type": int64(p[2])})
}
func decodeOrigin(p []byte, t float64) map[string]any {
	return sample(t, "gpsGlobalOrigin", map[string]any{"latDegE7": i32(p, 0), "lonDegE7": i32(p, 4), "altMm": i32(p, 8)})
}
func decodeHome(p []byte, t float64) map[string]any {
	return sample(t, "homePosition", map[string]any{"latDegE7": i32(p, 0), "lonDegE7": i32(p, 4), "altMm": i32(p, 8)})
}
func decodeMissionItem(p []byte, t float64) map[string]any {
	return sample(t, "missionItemInt", map[string]any{"seq": u16(p, 28), "command": u16(p, 30), "frameId": int64(p[34]), "current": p[35] != 0, "autocontinue": p[36] != 0, "param1": f32(p, 0), "param2": f32(p, 4), "param3": f32(p, 8), "param4": f32(p, 12), "latDegE7": i32(p, 16), "lonDegE7": i32(p, 20), "altM": f32(p, 24)})
}
func decodeVFR(p []byte, t float64) map[string]any {
	return sample(t, "vfrHud", map[string]any{"airSpeedMps": f32(p, 0), "groundSpeedMps": f32(p, 4), "climbMps": f32(p, 12), "headingDeg": i16(p, 16)})
}
func decodeCommandAck(p []byte, t float64) map[string]any {
	return sample(t, "commandAck", map[string]any{"command": u16(p, 0), "result": int64(p[2])})
}
