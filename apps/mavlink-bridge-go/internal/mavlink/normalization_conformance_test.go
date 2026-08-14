package mavlink

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/contractpath"
)

type malformedVector struct {
	CaseID               string `json:"caseId"`
	Kind                 string `json:"kind"`
	Hex                  string `json:"hex"`
	Version              int    `json:"version"`
	MessageID            uint32 `json:"messageId"`
	PayloadLength        int    `json:"payloadLength"`
	CorruptCRC           bool   `json:"corruptCrc"`
	Signed               bool   `json:"signed"`
	ExpectedEnvelopes    int    `json:"expectedEnvelopes"`
	ExpectedDecodeErrors int    `json:"expectedDecodeErrors"`
}
type normalizationVectors struct {
	NormalizationAtMs float64 `json:"normalizationAtMs"`
	Normalization     []struct {
		CaseID          string          `json:"caseId"`
		MessageID       uint32          `json:"messageId"`
		PayloadHex      string          `json:"payloadHex"`
		ExpectedPayload json.RawMessage `json:"expectedPayload"`
	} `json:"normalizationVectors"`
	Messages []struct {
		MessageID   uint32 `json:"messageId"`
		MessageName string `json:"messageName"`
		CRCExtra    byte   `json:"crcExtra"`
		MinLength   int    `json:"minLength"`
		MaxLength   int    `json:"maxLength"`
	} `json:"messages"`
	Malformed []malformedVector `json:"malformedCases"`
}

func canonicalJSON(t *testing.T, raw []byte) any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}
func TestDialectDerivedNormalizedPayloads(t *testing.T) {
	vectors := readNormalizationVectors(t)
	if len(vectors.Normalization) != 15 {
		t.Fatalf("normalization vectors=%d", len(vectors.Normalization))
	}
	extras := map[uint32]byte{}
	for _, m := range vectors.Messages {
		extras[m.MessageID] = m.CRCExtra
	}
	for _, fixture := range vectors.Normalization {
		payload, err := hex.DecodeString(fixture.PayloadHex)
		if err != nil {
			t.Fatal(err)
		}
		raw := BuildV1(byte(fixture.MessageID), payload, 7, 1, 1, extras[fixture.MessageID])
		envelopes, errors := ParseDatagram(raw, vectors.NormalizationAtMs)
		if errors != 0 || len(envelopes) != 1 {
			t.Errorf("%s envelopes=%d errors=%d", fixture.CaseID, len(envelopes), errors)
			continue
		}
		actual, err := json.Marshal(envelopes[0].Payload)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(canonicalJSON(t, actual), canonicalJSON(t, fixture.ExpectedPayload)) {
			t.Errorf("%s payload=%s want=%s", fixture.CaseID, actual, fixture.ExpectedPayload)
		}
	}
}

func readNormalizationVectors(t *testing.T) normalizationVectors {
	t.Helper()
	path, err := contractpath.Find("contracts/mavlink/normalization-frame-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var result normalizationVectors
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func buildFixtureFrame(version int, id uint32, length int, extra byte, corrupt, signed bool) []byte {
	payload := make([]byte, length)
	if version == 1 {
		frame := BuildV1(byte(id), payload, 7, 1, 1, extra)
		if corrupt {
			frame[len(frame)-1] ^= 0xff
		}
		return frame
	}
	signature := 0
	if signed {
		signature = 13
	}
	frame := make([]byte, 10+length+2+signature)
	frame[0] = 0xfd
	frame[1] = byte(length)
	if signed {
		frame[2] = 1
	}
	frame[4] = 7
	frame[5] = 1
	frame[6] = 1
	frame[7] = byte(id)
	frame[8] = byte(id >> 8)
	frame[9] = byte(id >> 16)
	crc := ComputeCRC(frame[1:10+length], extra)
	if corrupt {
		crc ^= 0xffff
	}
	binary.LittleEndian.PutUint16(frame[10+length:], crc)
	if signed {
		for i := 12 + length; i < len(frame); i++ {
			frame[i] = 0xa5
		}
	}
	return frame
}
func TestDialectBoundariesAllFamilies(t *testing.T) {
	vectors := readNormalizationVectors(t)
	if len(vectors.Messages) != 15 {
		t.Fatalf("messages=%d", len(vectors.Messages))
	}
	for _, m := range vectors.Messages {
		cases := []struct {
			name            string
			version, length int
			accepted        bool
		}{{"v1-min", 1, m.MinLength, true}, {"v1-short", 1, m.MinLength - 1, false}, {"v1-long", 1, m.MinLength + 1, false}, {"v2-one", 2, 1, true}, {"v2-max", 2, m.MaxLength, true}, {"v2-empty", 2, 0, false}, {"v2-oversized", 2, m.MaxLength + 1, false}}
		for _, c := range cases {
			envelopes, errors := ParseDatagram(buildFixtureFrame(c.version, m.MessageID, c.length, m.CRCExtra, false, false), 1234)
			want := 0
			if c.accepted {
				want = 1
			}
			if len(envelopes) != want || errors != 1-want {
				t.Errorf("%s/%s envelopes=%d errors=%d", m.MessageName, c.name, len(envelopes), errors)
			}
		}
	}
}
func TestMalformedFixtureAccounting(t *testing.T) {
	vectors := readNormalizationVectors(t)
	byID := map[uint32]byte{}
	for _, m := range vectors.Messages {
		byID[m.MessageID] = m.CRCExtra
	}
	for _, fixture := range vectors.Malformed {
		var raw []byte
		if fixture.Kind == "literal" {
			decoded, err := hex.DecodeString(fixture.Hex)
			if err != nil {
				t.Fatal(err)
			}
			raw = decoded
		} else {
			raw = buildFixtureFrame(fixture.Version, fixture.MessageID, fixture.PayloadLength, byID[fixture.MessageID], fixture.CorruptCRC, fixture.Signed)
			if fixture.Kind == "noise-before-supported" {
				raw = append([]byte{1, 2, 3}, raw...)
			}
		}
		envelopes, errors := ParseDatagram(raw, 1234)
		if len(envelopes) != fixture.ExpectedEnvelopes || errors != fixture.ExpectedDecodeErrors {
			t.Errorf("%s envelopes=%d errors=%d", fixture.CaseID, len(envelopes), errors)
		}
	}
}

func TestStrictJSONIngressFixtures(t *testing.T) {
	validPath, err := contractpath.Find("contracts/fixtures/valid/normalized-envelopes.json")
	if err != nil {
		t.Fatal(err)
	}
	validData, err := os.ReadFile(validPath)
	if err != nil {
		t.Fatal(err)
	}
	var valid []json.RawMessage
	if err := json.Unmarshal(validData, &valid); err != nil {
		t.Fatal(err)
	}
	if len(valid) != 15 {
		t.Fatalf("valid JSON cases=%d", len(valid))
	}
	for index, raw := range valid {
		envelopes, errors := ParseDatagram(raw, 999)
		if len(envelopes) != 1 || errors != 0 {
			t.Errorf("valid case %d envelopes=%d errors=%d", index, len(envelopes), errors)
		}
	}
	invalidPath, err := contractpath.Find("contracts/fixtures/invalid/normalized-envelope-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	invalidData, err := os.ReadFile(invalidPath)
	if err != nil {
		t.Fatal(err)
	}
	var invalid []struct {
		CaseID string          `json:"caseId"`
		Frame  json.RawMessage `json:"frame"`
	}
	if err := json.Unmarshal(invalidData, &invalid); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range invalid {
		envelopes, errors := ParseDatagram(fixture.Frame, 999)
		if len(envelopes) != 0 || errors != 1 {
			t.Errorf("%s envelopes=%d errors=%d", fixture.CaseID, len(envelopes), errors)
		}
	}
}

func TestRejectsNonFiniteNormalizedBinaryValueOnce(t *testing.T) {
	payload := make([]byte, 28)
	binary.LittleEndian.PutUint32(payload[4:], 0x7fc00000)
	envelopes, errors := ParseDatagram(BuildV1(30, payload, 7, 1, 1, 39), 1234)
	if len(envelopes) != 0 || errors != 1 {
		t.Fatalf("envelopes=%d errors=%d", len(envelopes), errors)
	}
}
